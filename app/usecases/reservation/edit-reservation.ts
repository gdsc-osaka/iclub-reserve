import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import type { FacilityRepository } from "~/domain/facility";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createReservationMailDrafts, editMailEvent } from "~/domain/mail/reservation-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  type ReservationError,
  type ReservationRepository,
  type ReservationStatus,
} from "~/domain/reservation";
import {
  canEditReservation,
  changedContentFields,
  editTargetStatus,
  requiresOverlapCheck,
  resolveEditOutcome,
  ReservationEditOutcome,
  type ReservationContent,
} from "~/domain/reservation/edit";
import { validateReservationDraft } from "~/domain/reservation/validation";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { ensureNoApprovedOverlap } from "./_shared/approved-overlap";
import { ensureFacilityIsAvailable } from "./_shared/facility-availability";
import { toRecipientsError } from "./_shared/mail-recipients";
import { resolveReservationActor } from "./_shared/reservation-authorization";

/** 予約の内容を変えるユースケースの依存 */
export interface EditReservationDeps {
  readonly reservationRepository: ReservationRepository;
  /** 操作する人が予約の団体に所属しているかを確かめるために使う */
  readonly membershipRepository: MembershipRepository;
  /** 施設を変えるときに、変更先の施設・設備が使えるかを確かめるために使う */
  readonly facilityRepository: FacilityRepository;
  /** 変更通知（EVT-004 / EVT-012）の宛先（申請者・団体管理者全員・事務局）を取得するために使う */
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

/** 予約の内容を変えるユースケースの引数 */
export interface EditReservationArgs {
  /** 変える予約の ID。画面では URL から取ること（フォームの値を信じない） */
  readonly reservationId: string;
  /** 操作する人のユーザー ID */
  readonly actorUserId: string;
  /** 操作する人が事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** 「開始日時を過ぎたか」「過去の日時か」を判定する基準で、更新日時にもなる */
  readonly now: Date;
  /**
   * 変更後の内容。変えない項目も、いまの値のまま渡す。
   *
   * 備考は、空欄を null にそろえてから渡すこと（申請と同じ）。
   * 空文字のまま渡すと、null の備考と別の値と見なされ、変えていないのに変更として扱われる。
   */
  readonly content: ReservationContent;
}

/** 予約の内容を変えるユースケースの返却値 */
export interface EditReservationResult {
  readonly reservationId: string;
  /** 変更の結果。NoChange のときは何も書き込んでいない */
  readonly outcome: ReservationEditOutcome;
  /** 変更後の予約ステータス */
  readonly status: ReservationStatus;
}

/**
 * 予約の内容（施設・日時・使用人数・備考）を変えるユースケース（UC-005 / UC-017）。
 *
 * どの項目を変えたかで、予約に起きることが変わる（COND-005）。
 * - 仮予約: どの項目を変えても仮予約のまま（UC-017 / EVT-012）
 * - 承認済み: 使用人数・備考だけなら承認済みのまま（BUC-004 / EVT-004）。
 *   施設・日時を変えると仮予約に戻り、事務局の再承認が要る（BUC-018 / EVT-004）
 *
 * 1 項目も変えていなければ、何も書き込まず通知もしない。保存し直しただけで
 * 関係者全員に変更通知が届くのを避けるため。
 *
 * 【確かめる順序の理由】
 * 権限・状態（canEditReservation）を、入力の検証（validateReservationDraft）より先に置く。
 * 変えられない予約に「時間帯を選び直してください」と返しても、選び直したところで結局は弾かれる。
 * 入力の規則は申請（COND-021）と同じで、開始日時を過ぎた予約は項目を問わず変えられない。
 *
 * 施設の状態と承認済みの予約との重なり（COND-001）は、施設・日時を変えたときだけ確かめる。
 * 変えていない施設・時間帯を確かめ直すと、仮予約どうしの重なりの片方が承認されたあと、
 * 残った仮予約の備考すら直せなくなる（overlapCheckFields を参照）。
 * 重なりの確認と通知先の取得は同時に投げる。どちらも D1 への往復なので、順に待つと待ち時間になる。
 *
 * 【最後の更新を条件付きで行う理由】
 * 予約を読んでから書くまでの間に、事務局の承認・却下や別の人の変更が割り込むことがある。
 * D1 では確認と更新を 1 つのトランザクションで囲めないため、「読んだときのステータスと更新日時から
 * 変わっていないこと」と、施設・日時を変えるときは「変更後の時間帯に承認済みの予約が無いこと」を
 * UPDATE 文の条件に持ち込む。変更通知は、その UPDATE と不可分に outbox へ積む（ADR-002 決定 3）。
 *
 * 事務局による直接変更（UC-008）はこのユースケースでは扱わない。事務局の人は、
 * 自分が所属する団体の予約に限り、メンバーとして変えられる。
 */
export const editReservationUseCase = (
  deps: EditReservationDeps,
  args: EditReservationArgs,
): ResultAsync<EditReservationResult, ReservationError> =>
  safeTry(async function* () {
    const now = args.now;
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    /*
     * 事務局の役割には変更（Edit）が無いので、事務局であっても所属を引く。
     * 自分が所属する団体の予約なら、メンバーとしての役割で変えられる。
     */
    const actor = yield* resolveReservationActor(
      deps,
      reservation.groupId,
      args,
      ReservationAction.Edit,
    );

    // 誰が・いまの状態・開始前か（COND-009 / STATE-001）
    yield* canEditReservation(reservation, actor, now);
    // 入力の検証（COND-021）。申請と同じ規則を当てる
    yield* validateReservationDraft(args.content, now);
    const content = args.content;

    const changed = changedContentFields(reservation, content);
    const outcome = resolveEditOutcome(reservation.status, changed);

    if (outcome === ReservationEditOutcome.NoChange) {
      return okAsync({ reservationId: reservation.id, outcome, status: reservation.status });
    }

    if (changed.has("facilityId")) {
      yield* ensureFacilityIsAvailable(deps, content.facilityId);
    }

    const checksOverlap = requiresOverlapCheck(changed);
    const overlapCheck = checksOverlap
      ? ensureNoApprovedOverlap(
          deps,
          { ...content, excludeReservationId: reservation.id },
          "選んだ時間帯には、すでに承認済みの予約が入っています。別の時間帯を選んでください。",
        )
      : okAsync<null, ReservationError>(null);

    // 変更通知（EVT-004 / EVT-012）を組み立てる。日時は変更後のものを載せる
    const mailDraftsCheck = deps.reservationMailRecipientsQuery
      .findByReservationId(reservation.id)
      .mapErr(toRecipientsError)
      .map((audience) =>
        createReservationMailDrafts(
          editMailEvent[outcome],
          {
            id: reservation.id,
            startAt: content.startAt,
            endAt: content.endAt,
            statusReason: null,
            updatedAt: now,
          },
          audience,
        ),
      );

    // この 2 つは同時に投げる。どちらも D1 への往復なので、順に待つとそのまま待ち時間になる
    const [, mailDrafts] = yield* ResultAsync.combine([overlapCheck, mailDraftsCheck]);

    const status = editTargetStatus[outcome];
    const result = yield* deps.reservationRepository.applyContentEdit(
      {
        id: reservation.id,
        expectedStatus: reservation.status,
        expectedUpdatedAt: reservation.updatedAt,
        facilityId: content.facilityId,
        startAt: content.startAt,
        endAt: content.endAt,
        headCount: content.headCount,
        note: content.note,
        status,
        updatedAt: now,
        requireNoApprovedOverlap: checksOverlap,
      },
      mailDrafts,
    );

    if (!result.applied) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.Conflict,
        message: `予約 ${reservation.id} は読んだ後に変わっていたか、変更先の時間帯が埋まったので、更新しなかった。`,
        userMessage:
          "この予約には別の操作が先に反映されました。画面を読み込み直して、内容を確認してください。",
      });
    }

    // 競合で 0 件更新だったときは outbox にも積まれていないため、ここへは来ない
    requestImmediateDelivery(deps.mailOutboxNotifier, result.enqueuedMailIds);

    return okAsync({ reservationId: reservation.id, outcome, status });
  });
