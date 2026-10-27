import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import type { AuditLogDraft } from "~/domain/audit-log";
import { toCalendarSyncDraft } from "~/domain/calendar";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import {
  createReservationMailDrafts,
  transitionMailEvent,
  type ReservationMailAudience,
} from "~/domain/mail/reservation-mail";
import { selectApprovalMailRecipients } from "~/domain/mail/reservation-message-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ReservationError,
  type ReservationRepository,
  type UnlockArrangement,
} from "~/domain/reservation";
import {
  toReservationStatusChanges,
  transitionAuditLogAction,
} from "~/domain/reservation/audit-log";
import {
  isSentAsStaff,
  validateOptionalReservationMessageBody,
  type ReservationMessage,
} from "~/domain/reservation/message";
import {
  canPerformTransition,
  canTransition,
  isStaffTransition,
  ReservationTransition,
  transitionAuthority,
  transitionSourceStatus,
  transitionTargetStatus,
  validateTransitionReason,
  type ReservationActor,
} from "~/domain/reservation/transition";
import { validateUnlockArrangement } from "~/domain/reservation/unlock-arrangement";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { ensureNoApprovedOverlap } from "./_shared/approved-overlap";
import { toRecipientsError } from "./_shared/mail-recipients";
import { resolveReservationActor } from "./_shared/reservation-authorization";

/** 予約ステータス変更ユースケースの依存 */
export interface ChangeReservationStatusDeps {
  readonly reservationRepository: ReservationRepository;
  /** 操作者が予約の団体に所属しているかを確かめるために使う（COND-009） */
  readonly membershipRepository: MembershipRepository;
  /** 状態変更通知メールの宛先を取得するためのクエリ */
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

/** 予約ステータス変更ユースケースの引数 */
export interface ChangeReservationStatusArgs {
  /** 操作対象の予約 ID */
  readonly reservationId: string;
  /** 操作を実行するユーザーの ID */
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  /** 実行する状態遷移操作 */
  readonly transition: ReservationTransition;
  /** 操作の理由（承認では使わず、それ以外の操作では必須。COND-002） */
  readonly reason?: string | null;
  /**
   * 施設の解錠の手配（COND-027）。
   *
   * 承認（Approve）のときだけ使い、それ以外の操作では送られてきても読まず列にも触れない。
   */
  readonly unlockArrangement?: UnlockArrangement | null;
  /**
   * 承認と同時に団体へ送るメッセージ（REQ-048 / COND-023）。画面から届いた未検証の本文。
   *
   * 承認（Approve）のときだけ使い、それ以外の操作では送られてきても読まない。
   * 欄は任意なので、空欄や空白だけなら添えなかったものとして扱う。
   */
  readonly message?: string | null;
  /** 更新日時の基準となる日時（テスト容易化のため任意指定可能） */
  readonly now?: Date;
  /** 通知メールに載せる予約詳細へのリンクの起点（`resolveAppBaseUrl` の値） */
  readonly appBaseUrl: string;
}

/** 予約ステータス変更ユースケースの返却値 */
export interface ChangeReservationStatusResult {
  readonly reservationId: string;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  /** 承認と同時に送ったメッセージの ID。添えなかったときは null */
  readonly messageId: string | null;
}

/**
 * 状態変更の通知（EVT-002/003/005/006/007）の宛先を引く。
 *
 * 承認と同時にメッセージを送ったときは、メッセージ通知（EVT-008）を別に送らないかわりに、
 * EVT-008 で事務局としての送信を受け取る人（その予約に団体側としてメッセージを送ったことのある人）も
 * 承認通知の宛先に加える（EVT-005）。どちらの読み取りも、申請者・団体の管理者を同じ条件で引く。
 */
const resolveTransitionMailAudience = (
  deps: Pick<ChangeReservationStatusDeps, "reservationMailRecipientsQuery">,
  reservationId: string,
  message: ReservationMessage | null,
): ResultAsync<ReservationMailAudience, ReservationError> => {
  if (message === null) {
    return deps.reservationMailRecipientsQuery
      .findByReservationId(reservationId)
      .mapErr(toRecipientsError);
  }

  return deps.reservationMailRecipientsQuery
    .findForMessage(reservationId)
    .mapErr(toRecipientsError)
    .map((audience) => ({
      groupMembers: selectApprovalMailRecipients(audience, message.senderId),
      // 承認通知は事務局に送らない（notifiesStaff）。操作したのが事務局のため
      staff: [],
    }));
};

/**
 * 予約のステータスを変更するユースケース（UC-003 / UC-004 / UC-006 / UC-007）。
 *
 * 【確かめる順序の理由】
 * 権限と状態遷移（canTransition）を、理由の検証（validateTransitionReason）より先に置く。
 * 操作そのものが許されていない人に「理由を入力してください」と返しても、
 * 入力し直したところで結局は弾かれる。承認で選ぶ解錠の手配（validateUnlockArrangement・COND-027）も、
 * 同じ理由で理由の検証の後に確かめる。承認と同時に送るメッセージの本文（COND-023）は、その後に確かめる。
 * 事務局だけの操作では、事務局かどうかをさらに前、予約を引くより前に確かめる
 * （予約の有無を事務局でない人に伝えないため。本文のコメントを参照）。
 *
 * 重複の確認と通知先の取得は同時に投げる。どちらも D1 への往復なので、
 * 順に待つとそのぶん利用者の待ち時間になる。
 *
 * 【最後の更新を条件付きで行う理由】
 * findById から更新までの間に別の操作が割り込むことがある
 * （例: 重なった仮予約を 2 人の事務局が同時に承認する、承認しようとした仮予約の日時を
 * 団体のメンバーが変える）。D1 では確認と更新を 1 つのトランザクションで囲めないため、
 * ここまでの確認結果には頼らず、「読んだときのステータスと更新日時から変わっていないこと」を
 * UPDATE 文の条件に持ち込む。
 * 状態変更通知メールは、その UPDATE と不可分に outbox へ積む（ADR-002 決定 3）。
 *
 * 【承認と同時に送るメッセージ（REQ-048 / COND-023）】
 * メッセージの行も同じ UPDATE と不可分に書く。承認が通らなければ（COND-001 や競合）メッセージも残らず、
 * 本文が条件を満たさなければ承認もしない。通知は承認通知（EVT-005）の 1 通にまとめ、
 * メッセージ通知（EVT-008）は積まない。別に送ると、団体には短い間に 2 通届くためである。
 * 送った人の既読（COND-026 (5)）は、予約詳細からの送信と同じく、ルートの側で進める。
 */
export const changeReservationStatusUseCase = (
  deps: ChangeReservationStatusDeps,
  args: ChangeReservationStatusArgs,
): ResultAsync<ChangeReservationStatusResult, ReservationError> =>
  safeTry(async function* () {
    const now = args.now ?? new Date();

    /*
     * 事務局だけの操作（承認・却下・事務局キャンセル）は、予約を引く前に事務局かどうかを確かめる。
     * 判定に予約も所属も要らないうえ、引いてから確かめると、予約が無い（NotFound）か
     * 許されない（Forbidden）かの応答の違いから、事務局でない人に予約の有無が伝わってしまう。
     * 下の canTransition でも同じ判定をもう一度通るが、同じ関数なので食い違うことはない。
     */
    const authority = transitionAuthority[args.transition];
    const staffActor: ReservationActor = { isStaff: args.isStaff, membership: null };
    if (authority === "staff") {
      yield* canPerformTransition(args.transition, staffActor);
    }

    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    /*
     * 操作する人を組み立てる（COND-030 の (1)）。
     *
     * 事務局の画面からの操作なら所属を読まず、利用者の画面からなら所属を読む。
     */
    const actor: ReservationActor = yield* resolveReservationActor(deps, reservation.groupId, args);

    // 誰が・いまの状態から動かせるか（COND-009 / STATE-001）
    yield* canTransition(reservation, args.transition, actor);
    // 理由の検証（COND-002）。正規化した値をそのまま保存する
    const statusReason = yield* validateTransitionReason(args.transition, args.reason);
    // 解錠の手配の検証（COND-027）。承認のときだけ必須で検証し、それ以外の操作では読まない
    const unlockArrangement =
      args.transition === ReservationTransition.Approve
        ? yield* validateUnlockArrangement(args.unlockArrangement ?? null)
        : undefined;
    // 承認と同時に送るメッセージの検証（COND-023）。承認のときだけ読み、空欄なら添えない
    const messageBody =
      args.transition === ReservationTransition.Approve
        ? yield* validateOptionalReservationMessageBody(args.message ?? null)
        : null;
    /*
     * 承認できるのは事務局の画面だけなので、sent_as_staff は必ず true になる。
     * それでも UC-009 と同じ判定（isSentAsStaff）で決め、決め方を 1 か所にまとめておく（COND-023）。
     * 送った日時は承認と同じにする。
     */
    const message: ReservationMessage | null =
      messageBody === null
        ? null
        : {
            id: createId(),
            reservationId: reservation.id,
            senderId: args.actorUserId,
            sentAsStaff: isSentAsStaff(actor),
            body: messageBody,
            sentAt: now,
          };

    // 承認のときだけ、同一施設・同一時間帯の承認済み予約を確かめる（COND-001）
    const overlapCheck =
      args.transition === ReservationTransition.Approve
        ? ensureNoApprovedOverlap(
            deps,
            reservation,
            "同一施設・同一時間帯に別の承認済み予約が存在します。先にそちらをキャンセルしてください。",
          )
        : okAsync<null, ReservationError>(null);

    // 状態変更通知メール（EVT-002/003/005/006/007）を組み立てる
    const mailDraftsCheck = resolveTransitionMailAudience(deps, reservation.id, message).map(
      (audience) =>
        createReservationMailDrafts(
          transitionMailEvent[args.transition],
          {
            id: reservation.id,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
            statusReason,
            unlockArrangement: unlockArrangement ?? reservation.unlockArrangement,
            updatedAt: now,
          },
          audience,
          args.appBaseUrl,
          message?.body ?? null,
        ),
    );

    // この 2 つは同時に投げる。どちらも D1 への往復なので、順に待つとそのまま待ち時間になる
    const [, mailDrafts] = yield* ResultAsync.combine([overlapCheck, mailDraftsCheck]);

    const targetStatus = transitionTargetStatus[args.transition];
    const auditLog: AuditLogDraft = {
      occurredAt: now,
      actorId: args.actorUserId,
      actedAsStaff: isStaffTransition(args.transition),
      action: transitionAuditLogAction[args.transition],
      targetId: reservation.id,
      groupId: reservation.groupId,
      changes: toReservationStatusChanges(reservation, {
        status: targetStatus,
        statusReason,
        unlockArrangement,
      }),
    };

    const calendarSyncDraft = toCalendarSyncDraft(
      reservation.id,
      {
        status: reservation.status,
        facilityId: reservation.facilityId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      },
      {
        status: targetStatus,
        facilityId: reservation.facilityId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      },
    );

    const outcome = yield* deps.reservationRepository.applyStatusTransition(
      {
        id: reservation.id,
        expectedStatus: transitionSourceStatus[args.transition],
        expectedUpdatedAt: reservation.updatedAt,
        status: targetStatus,
        statusReason,
        unlockArrangement,
        updatedAt: now,
        requireNoApprovedOverlap: args.transition === ReservationTransition.Approve,
      },
      mailDrafts,
      auditLog,
      calendarSyncDraft,
      message,
    );

    if (!outcome.applied) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.Conflict,
        message: `予約 ${reservation.id} は読んだ後に状態か内容が変わっていたので、更新しなかった。`,
        userMessage:
          "この予約には別の操作が先に反映されました。画面を読み込み直して、状態と内容を確認してください。",
      });
    }

    // 競合で 0 件更新だったときは outbox にもメッセージにも書かれていないため、ここへは来ない
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    return okAsync({
      reservationId: reservation.id,
      status: targetStatus,
      statusReason,
      messageId: message?.id ?? null,
    });
  });
