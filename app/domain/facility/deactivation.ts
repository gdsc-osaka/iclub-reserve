import { ReservationStatus } from "../reservation";

/**
 * 予約情報のうち、施設無効化の可否判定に必要な属性。
 */
export interface ReservationForDeactivationCheck {
  readonly status: ReservationStatus;
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * 施設・設備の無効化を阻害する予約かどうかを判定する純粋関数（COND-003）。
 *
 * 【判定条件】
 * 次のどちらかに当たる予約が 1 件でもあれば無効化を拒否する:
 * 1. 仮予約（provisional）で end_at > now（開始時刻を過ぎた仮予約も含む）
 * 2. 承認済み（approved）で start_at > now
 *
 * 【対象外となる予約】
 * - 現在使用中の承認済み予約（start_at <= now かつ end_at >= now）
 * - 既に終了した予約（end_at <= now）
 * - 取り消し済み（withdrawn）、却下済み（rejected）、キャンセル済み（cancelled, cancelled_by_staff）
 *
 * NOTE: infra の SQL（countBlockingReservations および updateActiveStatus）は
 * この関数を書き写したものになるため、片方を変えたらもう片方も必ず直すこと。
 */
export const isBlockingReservation = (
  reservation: ReservationForDeactivationCheck,
  now: Date,
): boolean => {
  const nowMs = now.getTime();
  const startMs = reservation.startAt.getTime();
  const endMs = reservation.endAt.getTime();

  // ① 仮予約で終了日時が現在より未来（開始時刻を過ぎた仮予約も含む）
  if (reservation.status === ReservationStatus.Provisional) {
    return endMs > nowMs;
  }

  // ② 承認済みで開始日時が現在より未来
  if (reservation.status === ReservationStatus.Approved) {
    return startMs > nowMs;
  }

  // 取り消し済み・却下済み・キャンセル済み、および使用中の承認済み予約はすべて無効化を止めない
  return false;
};
