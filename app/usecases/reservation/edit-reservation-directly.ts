import { errAsync, okAsync, ResultAsync, safeTry } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { FacilityRepository } from "~/domain/facility";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { directEditMailEvent } from "~/domain/mail/reservation-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  type ReservationError,
  type ReservationRepository,
  type ReservationStatus,
} from "~/domain/reservation";
import { toReservationContentEditChanges } from "~/domain/reservation/audit-log";
import {
  canDirectEditReservation,
  changedContentFields,
  requiresOverlapCheck,
  resolveDirectEditOutcome,
  ReservationEditOutcome,
  type ReservationContent,
} from "~/domain/reservation/edit";
import { validateReservationDraft } from "~/domain/reservation/validation";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { APPROVED_OVERLAP_MESSAGE } from "./_shared/approved-overlap";
import { resolveEditOverlapAndMails, toEditConflictError } from "./_shared/edit-reservation-common";
import { ensureFacilityIsAvailable } from "./_shared/facility-availability";
import { resolveReservationActor } from "./_shared/reservation-authorization";

/** 事務局が予約の内容を直接変更するユースケースの依存 */
export interface EditReservationDirectlyDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  /** 施設を変えるときに、変更先の施設・設備が使えるかを確かめるために使う */
  readonly facilityRepository: FacilityRepository;
  /** 変更通知（EVT-017）の宛先（申請者・団体管理者全員）を取得するために使う */
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

/** 事務局が予約の内容を直接変更するユースケースの引数 */
export interface EditReservationDirectlyArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  /** 操作する人が事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  readonly now: Date;
  readonly content: ReservationContent;
}

/** 事務局が予約の内容を直接変更するユースケースの返却値 */
export interface EditReservationDirectlyResult {
  readonly reservationId: string;
  readonly outcome: ReservationEditOutcome;
  readonly status: ReservationStatus;
}

/**
 * 事務局として予約の内容（施設・日時・使用人数・備考）を直接変更するユースケース（UC-008）。
 *
 * 団体の変更（UC-005）と異なり、ステータスは変更しない。
 * - 承認済みの予約は、施設・日時を変えても承認済みのまま（再承認は不要）。
 * - 仮予約は仮予約のまま（承認にはならない）。
 *
 * 1 項目も変えていなければ、何も書き込まず通知もしない（団体の変更と同じ）。
 *
 * 施設・日時を変えるときは、変更後の時間帯に承認済みの予約が無いこと（COND-001）を確かめる。
 * 重なりがあったときの文言は、直接作成と同じくキャンセルを促す文言にする。
 *
 * 変更が反映されたら、申請者・団体管理者全員へメールで通知する（EVT-017）。
 * 操作者が事務局自身であるため、事務局には通知を送らない。
 */
export const editReservationDirectlyUseCase = (
  deps: EditReservationDirectlyDeps,
  args: EditReservationDirectlyArgs,
): ResultAsync<EditReservationDirectlyResult, ReservationError> =>
  safeTry(async function* () {
    const now = args.now;
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    /*
     * 事務局の行に EditDirect が入っているため、事務局なら所属を引かずに済む。
     */
    const actor = yield* resolveReservationActor(
      deps,
      reservation.groupId,
      args,
      ReservationAction.EditDirect,
    );

    // 1. 誰が・いまの状態・開始前か（COND-009 / STATE-001）
    yield* canDirectEditReservation(reservation, actor, now);
    // 2. 入力の検証（COND-021）。申請と同じ規則を当てる
    yield* validateReservationDraft(args.content, now);
    const content = args.content;

    const changed = changedContentFields(reservation, content);
    const outcome = resolveDirectEditOutcome(reservation.status, changed);

    if (outcome === ReservationEditOutcome.NoChange) {
      return okAsync({ reservationId: reservation.id, outcome, status: reservation.status });
    }

    if (changed.has("facilityId")) {
      yield* ensureFacilityIsAvailable(deps, content.facilityId);
    }

    const checksOverlap = requiresOverlapCheck(changed);

    // 変更通知（EVT-017）の組み立てと重なりの確認を同時に投げる
    const mailDrafts = yield* resolveEditOverlapAndMails(deps, {
      reservationId: reservation.id,
      content,
      now,
      checksOverlap,
      overlapUserMessage: APPROVED_OVERLAP_MESSAGE,
      mailEvent: directEditMailEvent[outcome],
    });

    // 直接変更ではステータスを変えない（いまのステータスのまま）
    const status = reservation.status;
    const auditLog: AuditLogDraft = {
      occurredAt: now,
      actorId: args.actorUserId,
      actedAsStaff: true, // 事務局の直接変更なので true（COND-012）
      action: AuditLogAction.ReservationDirectChange,
      targetId: reservation.id,
      groupId: reservation.groupId,
      changes: toReservationContentEditChanges(reservation, {
        ...content,
        status,
        statusReason: reservation.statusReason,
      }),
    };

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
      auditLog,
    );

    /*
     * 0 件更新の原因は、時間帯が埋まったことのほかに、読んだ後に別の人が変更・承認したこともある。
     * どちらかは見分けられないので、重なりの文言ではなく、読み込み直しを促す文言で返す（団体の変更と同じ）。
     */
    if (!result.applied) {
      return errAsync<never, ReservationError>(toEditConflictError(reservation.id));
    }

    // 競合で 0 件更新だったときは outbox にも積まれていないため、ここへは来ない
    requestImmediateDelivery(deps.mailOutboxNotifier, result.enqueuedMailIds);

    return okAsync({ reservationId: reservation.id, outcome, status });
  });
