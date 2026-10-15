import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/**
 * 事務局側で未読として表示するメッセージ 1 件分の要約。
 */
export interface StaffUnreadLatestMessage {
  readonly body: string;
  readonly sentAt: Date;
}

/**
 * ダッシュボード「団体からの未読メッセージ」に並ぶ予約 1 行分のデータ（COND-026 (1)・(3)）。
 */
export interface StaffUnreadMessageItem {
  readonly reservationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /** 代表として出す最新のメッセージ */
  readonly latestMessage: StaffUnreadLatestMessage;
  /** 代表以外の未読件数（COND-026 (1)「ほか n 件」） */
  readonly otherCount: number;
}

/**
 * 事務局側の未読問い合わせ結果。
 */
export interface StaffUnreadMessagesResult {
  /** 表示する最大 10 件の未読行（COND-026 (6)） */
  readonly items: readonly StaffUnreadMessageItem[];
  /** 10 件を超えた予約の件数 */
  readonly overflowCount: number;
  /**
   * 未読のある予約すべての ID（10 件を超えた分も含む）。
   */
  readonly allUnreadReservationIds: readonly string[];
}

export interface StaffUnreadMessagesQuery {
  /**
   * 事務局側の未読メッセージを一覧取得する（COND-026 (3)）。
   */
  findUnreadForStaff(
    staffUserId: string,
    now: Date,
  ): ResultAsync<StaffUnreadMessagesResult, QueryError>;
}
