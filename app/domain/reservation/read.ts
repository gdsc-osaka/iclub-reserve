import type { ResultAsync } from "neverthrow";
import { addDays } from "~/lib/date";
import type { ReservationError } from "./index";

/**
 * 未読として出す出来事の期間（日数）（COND-026 (6)）。
 *
 * これより前の出来事は、既読の記録（INFO-012）が無くても未読として出さない。
 * 予約を開かないままでも、古い出来事がダッシュボードに残り続けないようにするため。
 */
export const UNREAD_LOOKBACK_DAYS = 30;

/**
 * 「確認が必要なこと」に出す行（予約）の上限（COND-026 (6)）。超えた分は件数だけを示す。
 */
export const UNREAD_ITEMS_LIMIT = 10;

/**
 * 未読として出す出来事の起点を返す純粋関数（COND-026 (6)）。
 *
 * この日時より後に起きた出来事だけを未読として扱う。
 */
export const unreadEventsSince = (now: Date): Date => addDays(now, -UNREAD_LOOKBACK_DAYS);

/**
 * 団体側で未読として表示する出来事の種類（COND-026 (2)）。
 */
export const GroupUnreadEventType = {
  Message: "message",
  Approve: "approve",
  Reject: "reject",
  StaffCancel: "staff_cancel",
  DirectCreate: "direct_create",
  DirectChange: "direct_change",
  UnlockArrangementUpdate: "unlock_arrangement_update",
} as const;

export type GroupUnreadEventType = (typeof GroupUnreadEventType)[keyof typeof GroupUnreadEventType];

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
   * 既存の last_read_at より前の時刻が渡されたときは書き換えない（後ろへは戻さない）。
   */
  upsert(userId: string, reservationId: string, readAt: Date): ResultAsync<void, ReservationError>;

  /**
   * 複数の予約の既読日時を 1 回の db.batch でまとめて upsert する。
   *
   * 既存の last_read_at より前の時刻が渡されたときは書き換えない（後ろへは戻さない）。
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
