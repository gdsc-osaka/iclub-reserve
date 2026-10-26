import type { ReservationListItem, ReservationListRow } from "~/query/reservation/reservation-list";

/**
 * 予約一覧の行から団体の ID などを落とし、画面へ渡してよい形に変換する純粋関数（COND-008）。
 *
 * 団体の ID は「自団体の予約かどうか」の絞り込み判定にのみ使い、
 * 画面へは団体名までしか渡さない。
 */
export const toReservationListItem = (row: ReservationListRow): ReservationListItem => ({
  id: row.id,
  groupName: row.groupName,
  facilityId: row.facilityId,
  facilityName: row.facilityName,
  startAt: row.startAt,
  endAt: row.endAt,
  status: row.status,
  statusReason: row.statusReason,
  headCount: row.headCount,
  note: row.note,
  createdByName: row.createdByName,
  requestedAt: row.requestedAt,
  hasApprovedOverlap: row.hasApprovedOverlap ?? false,
  hasProvisionalOverlap: row.hasProvisionalOverlap ?? false,
});
