import { ReservationStatus } from "~/domain/reservation";
import { StatusBadge, StatusTone } from "../status-badge";

/**
 * 予約の状態を利用者向けの日本語にする (STATE-001)。
 *
 * 「取り消し」は団体が承認前に自分で引っ込めた場合、
 * 「キャンセル」は承認後に取りやめた場合を指す。
 * 同じ言葉にすると、事務局の承認をまたいだかどうかが分からなくなる。
 */
export const reservationStatusLabel: Record<ReservationStatus, string> = {
  [ReservationStatus.Provisional]: "承認待ち",
  [ReservationStatus.Approved]: "承認済み",
  [ReservationStatus.Withdrawn]: "取り消し済み",
  [ReservationStatus.Rejected]: "却下済み",
  [ReservationStatus.Cancelled]: "キャンセル済み",
  [ReservationStatus.CancelledByStaff]: "事務局キャンセル",
};

const reservationStatusTone: Record<ReservationStatus, StatusTone> = {
  [ReservationStatus.Provisional]: StatusTone.Attention,
  [ReservationStatus.Approved]: StatusTone.Positive,
  // 自分で取りやめたものは想定内なので、目立たせない
  [ReservationStatus.Withdrawn]: StatusTone.Neutral,
  [ReservationStatus.Cancelled]: StatusTone.Neutral,
  // 事務局の判断で流れたものは理由を確認してほしいので目立たせる
  [ReservationStatus.Rejected]: StatusTone.Danger,
  [ReservationStatus.CancelledByStaff]: StatusTone.Danger,
};

/** 予約の状態を表すラベル。 */
export function ReservationStatusBadge({ status }: Readonly<{ status: ReservationStatus }>) {
  return (
    <StatusBadge tone={reservationStatusTone[status]} label={reservationStatusLabel[status]} />
  );
}
