import type { ResultAsync } from "neverthrow";

import type { GroupError } from "../group";

/**
 * DB に保存されている自団体の予約カレンダー購読情報。
 */
export interface StoredGroupCalendarFeed {
  readonly id: string;
  readonly membershipId: string;
  readonly token: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 発行・作り直しで書き込む値 */
export interface GroupCalendarFeedInput {
  readonly membershipId: string;
  readonly token: string;
  readonly now: Date;
}

/**
 * 自団体の予約カレンダー購読情報のリポジトリ（ADR-013 決定 6）。
 */
export interface GroupCalendarFeedRepository {
  /**
   * 所属 ID（group_member.id）でカレンダー購読情報を取得する。
   * まだ発行されていなければ null を返す。
   */
  findByMembershipId(membershipId: string): ResultAsync<StoredGroupCalendarFeed | null, GroupError>;

  /**
   * カレンダー購読を発行する。
   * 既に発行済みの場合は新規作成せず、既存の行をそのまま返す（onConflictDoNothing）。
   */
  issue(input: GroupCalendarFeedInput): ResultAsync<StoredGroupCalendarFeed, GroupError>;

  /**
   * カレンダー購読のトークンを作り直す。
   * 既存の行のトークンと updated_at を更新し、行が無ければ新規作成する（onConflictDoUpdate）。
   */
  regenerate(input: GroupCalendarFeedInput): ResultAsync<StoredGroupCalendarFeed, GroupError>;
}
