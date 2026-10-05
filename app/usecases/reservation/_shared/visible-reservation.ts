import type {
  ReservationFormReservation,
  ReservationFormReservationRow,
} from "~/query/reservation/reservation-form";

/**
 * 予約 1 件を、見ている人に見せてよい形に絞る（COND-008）。
 *
 * 予約申請・変更フォームが出すのは「その時間帯が埋まっているか」だけなので、
 * Query の時点で使用人数・備考を読んでいない。ここで落とすのは団体の ID で、
 * 画面は団体名しか出さないのにそのまま渡すと、
 * 使い道の無い識別子だけが他団体のぶんまで手元に残ることになる。
 */
export const toVisibleReservation = (
  row: ReservationFormReservationRow,
  myGroupIds: ReadonlySet<string>,
): ReservationFormReservation => ({
  id: row.id,
  facilityId: row.facilityId,
  groupName: row.groupName,
  startAt: row.startAt,
  endAt: row.endAt,
  status: row.status,
  isOwnGroup: myGroupIds.has(row.groupId),
});
