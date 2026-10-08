import {
  AuditLogAction,
  toCreatedChanges,
  toUpdatedChanges,
  type AuditLogChanges,
} from "../audit-log";
import { type AppliedReservationEdit, ReservationEditOutcome } from "./edit";
import type { Reservation, ReservationStatus } from "./index";
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
 */
export const toReservationCreatedChanges = (input: {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
  readonly status: ReservationStatus;
}): AuditLogChanges =>
  toCreatedChanges({
    facility_id: input.facilityId,
    start_at: input.startAt,
    end_at: input.endAt,
    head_count: input.headCount,
    note: input.note,
    status: input.status,
  });

/**
 * 予約の状態変更時の changes を組み立てる。
 *
 * status と status_reason を必ず含める（null -> null でも残す）。
 */
export const toReservationStatusChanges = (
  before: { readonly status: ReservationStatus; readonly statusReason: string | null },
  after: { readonly status: ReservationStatus; readonly statusReason: string | null },
): AuditLogChanges => ({
  status: {
    before: before.status,
    after: after.status,
  },
  status_reason: {
    before: before.statusReason,
    after: after.statusReason,
  },
});

/** 内容変更の記録で比べる予約の項目。ステータスも含める（UC-005 で仮予約に戻ることがあるため） */
type ReservationEditedFields = Pick<
  Reservation,
  "facilityId" | "startAt" | "endAt" | "headCount" | "note" | "status" | "statusReason"
>;

/**
 * 予約の内容変更時の changes を組み立てる。
 *
 * 変わった項目だけを残す。承認済みの予約の施設・日時を変えて仮予約に戻るとき（Reapproval）は、
 * status（approved → provisional）も変わった項目として入る。
 * 状態が変わるときは、ほかの状態の変更と同じく status_reason も含める（INFO-008）。
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
    },
    {
      facility_id: after.facilityId,
      start_at: after.startAt,
      end_at: after.endAt,
      head_count: after.headCount,
      note: after.note,
      status: after.status,
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
