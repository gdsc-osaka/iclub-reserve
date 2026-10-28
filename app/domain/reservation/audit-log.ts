import {
  AuditLogAction,
  toCreatedChanges,
  toUpdatedChanges,
  type AuditLogChanges,
} from "../audit-log";
import { type AppliedReservationEdit, ReservationEditOutcome } from "./edit";
import type { Reservation, ReservationStatus, UnlockArrangement } from "./index";
import { ReservationTransition } from "./transition";

/**
 * 予約の状態遷移に対応する AuditLogAction（VAR-002）。
 */
export const transitionAuditLogAction: Record<ReservationTransition, AuditLogAction> = {
  [ReservationTransition.Withdraw]: AuditLogAction.ReservationWithdraw,
  [ReservationTransition.Cancel]: AuditLogAction.ReservationCancel,
  [ReservationTransition.Approve]: AuditLogAction.ReservationApprove,
  [ReservationTransition.Reject]: AuditLogAction.ReservationReject,
  [ReservationTransition.StaffCancel]: AuditLogAction.ReservationStaffCancel,
};

/**
 * 団体の予約内容変更結果に対応する AuditLogAction（VAR-002）。
 */
export const groupEditAuditLogAction: Record<AppliedReservationEdit, AuditLogAction> = {
  [ReservationEditOutcome.KeepProvisional]: AuditLogAction.ReservationEditProvisional,
  [ReservationEditOutcome.KeepApproved]: AuditLogAction.ReservationChange,
  [ReservationEditOutcome.Reapproval]: AuditLogAction.ReservationChange,
};

/**
 * 予約の新規作成（申請・直接作成）時の changes を組み立てる。
 *
 * 解錠の手配（COND-027）は、直接作成（UC-008）で選んだときだけ渡して残す。
 * 申請（UC-002）では未定なので渡さない。
 */
export const toReservationCreatedChanges = (input: {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
  readonly status: ReservationStatus;
  readonly unlockArrangement?: UnlockArrangement;
}): AuditLogChanges =>
  toCreatedChanges({
    facility_id: input.facilityId,
    start_at: input.startAt,
    end_at: input.endAt,
    head_count: input.headCount,
    note: input.note,
    status: input.status,
    ...(input.unlockArrangement === undefined
      ? {}
      : { unlock_arrangement: input.unlockArrangement }),
  });

/**
 * 予約の状態変更時の changes を組み立てる。
 *
 * status と status_reason を必ず含める（null -> null でも残す）。
 * 承認（UC-006）では選んだ解錠の手配（COND-027）を after に渡し、unlock_arrangement も残す。
 * ほかの操作では渡さない（列に触れないので、記録にも残さない）。
 */
export const toReservationStatusChanges = (
  before: {
    readonly status: ReservationStatus;
    readonly statusReason: string | null;
    readonly unlockArrangement: UnlockArrangement | null;
  },
  after: {
    readonly status: ReservationStatus;
    readonly statusReason: string | null;
    readonly unlockArrangement?: UnlockArrangement;
  },
): AuditLogChanges => ({
  status: {
    before: before.status,
    after: after.status,
  },
  status_reason: {
    before: before.statusReason,
    after: after.statusReason,
  },
  ...(after.unlockArrangement === undefined
    ? {}
    : {
        unlock_arrangement: {
          before: before.unlockArrangement,
          after: after.unlockArrangement,
        },
      }),
});

/** 内容変更の記録で比べる予約の項目。ステータスも含める（UC-005 で仮予約に戻ることがあるため） */
type ReservationEditedFields = Pick<
  Reservation,
  | "facilityId"
  | "startAt"
  | "endAt"
  | "headCount"
  | "note"
  | "status"
  | "statusReason"
  | "unlockArrangement"
>;

/**
 * 予約の内容変更時の changes を組み立てる。
 *
 * 変わった項目だけを残す。承認済みの予約の施設・日時を変えて仮予約に戻るとき（Reapproval）は、
 * status（approved → provisional）も変わった項目として入る。
 * 状態が変わるときは、ほかの状態の変更と同じく status_reason も含める（INFO-008）。
 * 解錠の手配（unlock_arrangement）も、変わったときだけ残る（直接変更で選び直したときと、仮予約に戻って未定になったとき。COND-027）。
 */
export const toReservationContentEditChanges = (
  before: ReservationEditedFields,
  after: ReservationEditedFields,
): AuditLogChanges => {
  const changes = toUpdatedChanges(
    {
      facility_id: before.facilityId,
      start_at: before.startAt,
      end_at: before.endAt,
      head_count: before.headCount,
      note: before.note,
      status: before.status,
      unlock_arrangement: before.unlockArrangement,
    },
    {
      facility_id: after.facilityId,
      start_at: after.startAt,
      end_at: after.endAt,
      head_count: after.headCount,
      note: after.note,
      status: after.status,
      unlock_arrangement: after.unlockArrangement,
    },
  );

  if (before.status === after.status) {
    return changes;
  }
  return {
    ...changes,
    status_reason: { before: before.statusReason, after: after.statusReason },
  };
};

/**
 * 解錠の手配の更新（UC-038）時の changes を組み立てる。
 *
 * unlock_arrangement の before と after だけを残す（COND-027）。
 */
export const toReservationUnlockArrangementChanges = (
  before: { readonly unlockArrangement: UnlockArrangement | null },
  after: { readonly unlockArrangement: UnlockArrangement },
): AuditLogChanges => ({
  unlock_arrangement: {
    before: before.unlockArrangement,
    after: after.unlockArrangement,
  },
});
