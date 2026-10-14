import type { ResultAsync } from "neverthrow";
import type { ReservationError } from "./index";

/**
 * 既読の記録を使い始めた日時（COND-026 (4) / INFO-012）。
 *
 * この日時より前の出来事は、既読の記録（INFO-012）が無くても既読として扱う。
 * 使い始めた時点で、過去の出来事が一斉に未読としてダッシュボードに出るのを防ぐため。
 *
 * TODO: 今の値は作業をした日の 0 時（仮）。リリースする日に合わせて直す。
 */
export const UNREAD_TRACKING_STARTS_AT = new Date("2026-10-14T00:00:00+09:00");

/**
 * 既読の記録エンティティ（INFO-012）。
 */
export interface ReservationRead {
  readonly userId: string;
  readonly reservationId: string;
  readonly lastReadAt: Date;
}

/**
 * 既読の記録のリポジトリインターフェース（ポート）。
 */
export interface ReservationReadRepository {
  /**
   * 予約 1 件の既読日時を upsert する。
   *
   * 既存の last_read_at より前の時刻が渡されても、後ろへは戻さない（MAX を取る）。
   */
  upsert(userId: string, reservationId: string, readAt: Date): ResultAsync<void, ReservationError>;

  /**
   * 複数の予約の既読日時を 1 回の db.batch でまとめて upsert する。
   *
   * 既存の last_read_at より前の時刻が渡されても、後ろへは戻さない（MAX を取る）。
   */
  upsertMany(
    userId: string,
    reservationIds: readonly string[],
    readAt: Date,
  ): ResultAsync<void, ReservationError>;

  /**
   * ユーザーの特定の予約の既読記録を取得する。
   */
  findByUserAndReservation(
    userId: string,
    reservationId: string,
  ): ResultAsync<ReservationRead | null, ReservationError>;
}
