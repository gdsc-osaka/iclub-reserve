import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

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
} as const;

export type GroupUnreadEventType = (typeof GroupUnreadEventType)[keyof typeof GroupUnreadEventType];

/**
 * 予約 1 件についての未読の出来事の代表（最新のもの）。
 */
export interface GroupUnreadLatestEvent {
  readonly type: GroupUnreadEventType;
  readonly eventAt: Date;
  readonly messageBody?: string | null;
  readonly statusReason?: string | null;
}

/**
 * ダッシュボード「確認が必要なこと」に並ぶ予約 1 行分のデータ（COND-026 (1)）。
 */
export interface GroupUnreadUpdateItem {
  readonly reservationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /** 代表として出す最新の出来事 */
  readonly latestEvent: GroupUnreadLatestEvent;
  /** 代表以外の未読件数（COND-026 (1)「ほか n 件」） */
  readonly otherCount: number;
}

/**
 * 団体側の未読問い合わせ結果。
 */
export interface GroupUnreadUpdatesResult {
  /** 表示する最大 10 件の未読行（COND-026 (6)） */
  readonly items: readonly GroupUnreadUpdateItem[];
  /** 10 件を超えた予約の件数（超えた分は件数だけを示す） */
  readonly overflowCount: number;
  /**
   * 未読のある予約すべての ID（10 件を超えた分も含む）。
   *
   * 「すべて確認済みにする」で、画面から送られてきた ID が今も本人の未読かを確かめるのに使う。
   */
  readonly allUnreadReservationIds: readonly string[];
}

export interface GroupUnreadUpdatesQuery {
  /**
   * 団体側の未読を一覧取得する（COND-026）。
   */
  findUnreadForUser(userId: string, now: Date): ResultAsync<GroupUnreadUpdatesResult, QueryError>;
}
