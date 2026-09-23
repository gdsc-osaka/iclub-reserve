import type { ResultAsync } from "neverthrow";

import type { GroupStatus } from "~/domain/group";
import type { QueryError } from "../error";

/**
 * 事務局向け全団体一覧画面（SCR-008）の検索結果の 1 行。
 */
export interface GroupSearchItem {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  readonly memberCount: number;
  readonly createdAt: Date;
}

/** 団体検索結果の配列 */
export type GroupSearchList = readonly GroupSearchItem[];

/** 絞り込み条件 */
export interface GroupSearchCriteria {
  /** 絞り込むステータス。null のときは全ステータス */
  readonly status: GroupStatus | null;
}

/**
 * 事務局向け全団体検索の読み取り専用窓口（Query ポート / ADR-001）。
 *
 * Repository が「集約 1 件」を返すのに対し、Query は「画面 1 つ分」を返す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface GroupSearchQuery {
  /**
   * 条件に合致する団体一覧を取得する。
   *
   * 並び順:
   * - status が pending のとき: 作成日時の昇順 -> ID の昇順（待たせている団体から処理できるようにするため）
   * - それ以外（enabled / disabled / 全状態）: 団体名の昇順 -> ID の昇順
   */
  findList(criteria: GroupSearchCriteria): ResultAsync<GroupSearchList, QueryError>;

  /**
   * ステータスごとの団体数を集計する（各タブのバッジ件数用）。
   */
  countByStatus(): ResultAsync<Record<GroupStatus, number>, QueryError>;
}
