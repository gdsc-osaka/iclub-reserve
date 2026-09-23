import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createReservationMailDrafts, transitionMailEvent } from "~/domain/mail/reservation-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import {
  canTransition,
  ReservationTransition,
  transitionAuthority,
  transitionSourceStatus,
  transitionTargetStatus,
  validateTransitionReason,
  type ReservationActor,
} from "~/domain/reservation/transition";
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
  /** 操作ユーザーが事務局スタッフかどうか（COND-009） */
  readonly isStaff: boolean;
  /** 実行する状態遷移操作 */
  readonly transition: ReservationTransition;
  /** 操作の理由（却下・事務局キャンセルは必須、取り消し・キャンセルは任意） */
  readonly reason?: string | null;
  /** 更新日時の基準となる日時（テスト容易化のため任意指定可能） */
  readonly now?: Date;
}

/** 予約ステータス変更ユースケースの返却値 */
export interface ChangeReservationStatusResult {
  readonly reservationId: string;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
}

/**
 * 予約のステータスを変更するユースケース（UC-003 / UC-004 / UC-006 / UC-007）。
 *
 * 【確かめる順序の理由】
 * 権限と状態遷移（canTransition）を、理由の検証（validateTransitionReason）より先に置く。
 * 操作そのものが許されていない人に「理由を入力してください」と返しても、
 * 入力し直したところで結局は弾かれる。
 *
 * 重複の確認と通知先の取得は同時に投げる。どちらも D1 への往復なので、
 * 順に待つとそのぶん利用者の待ち時間になる。
 *
 * 【最後の更新を条件付きで行う理由】
 * findById から更新までの間に別の操作が割り込むことがある
 * （例: 重なった仮予約を 2 人の事務局が同時に承認する）。D1 では確認と更新を
 * 1 つのトランザクションで囲めないため、ここまでの確認結果には頼らず、
 * 「読んだときの状態から変わっていないこと」を UPDATE 文の条件に持ち込む。
 * 状態変更通知メールは、その UPDATE と不可分に outbox へ積む（ADR-002 決定 3）。
 */
export const changeReservationStatusUseCase = (
  deps: ChangeReservationStatusDeps,
  args: ChangeReservationStatusArgs,
): ResultAsync<ChangeReservationStatusResult, ReservationError> =>
  safeTry(async function* () {
    const now = args.now ?? new Date();

    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    /*
     * 操作する人を組み立てる。
     *
     * 事務局だけの操作（承認・却下・事務局キャンセル）は、canTransition が
     * isStaff しか見ないので所属を引きに行かない。引いても判定は変わらず、
     * D1 への往復が 1 回増えるだけになる。
     *
     * 取り消し・キャンセルは団体での役割で判定するので、事務局であっても所属を引く。
     * 事務局の人が自分の所属する団体の予約を取り消すときは、メンバーとしての
     * 役割が和集合で効くため、省くと取り消せなくなる。
     */
    const authority = transitionAuthority[args.transition];
    const actor: ReservationActor =
      authority === "staff"
        ? { isStaff: args.isStaff, membership: null }
        : yield* resolveReservationActor(deps, reservation.groupId, args, authority);

    // 誰が・いまの状態から動かせるか（COND-009 / STATE-001）
    yield* canTransition(reservation, args.transition, actor);
    // 理由の検証（COND-002）。正規化した値をそのまま保存する
    const statusReason = yield* validateTransitionReason(args.transition, args.reason);

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
    const mailDraftsCheck = deps.reservationMailRecipientsQuery
      .findByReservationId(reservation.id)
      .mapErr(toRecipientsError)
      .map((audience) =>
        createReservationMailDrafts(
          transitionMailEvent[args.transition],
          {
            id: reservation.id,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
            statusReason,
          },
          audience,
        ),
      );

    // この 2 つは同時に投げる。どちらも D1 への往復なので、順に待つとそのまま待ち時間になる
    const [, mailDrafts] = yield* ResultAsync.combine([overlapCheck, mailDraftsCheck]);

    const targetStatus = transitionTargetStatus[args.transition];
    const outcome = yield* deps.reservationRepository.applyStatusTransition(
      {
        id: reservation.id,
        expectedStatus: transitionSourceStatus[args.transition],
        status: targetStatus,
        statusReason,
        updatedAt: now,
        requireNoApprovedOverlap: args.transition === ReservationTransition.Approve,
      },
      mailDrafts,
    );

    if (!outcome.applied) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.Conflict,
        message: `予約 ${reservation.id} は読んだ後に状態が変わっていたので、更新しなかった。`,
        userMessage:
          "この予約には別の操作が先に反映されました。画面を読み込み直して、状態を確認してください。",
      });
    }

    // 競合で 0 件更新だったときは outbox にも積まれていないため、ここへは来ない
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    return okAsync({
      reservationId: reservation.id,
      status: targetStatus,
      statusReason,
    });
  });
