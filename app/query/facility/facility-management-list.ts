import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/**
 * 事務局向け施設管理一覧画面（SCR-009）の 1 行。
 */
export interface FacilityManagementItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  readonly hasGoogleCalendar: boolean;
  readonly updatedAt: Date;
}

/** 施設管理一覧の配列 */
export type FacilityManagementList = readonly FacilityManagementItem[];

/**
 * 施設管理一覧の読み取り専用窓口（Query ポート / ADR-001）。
 *
 * Repository が「集約 1 件」を返すのに対し、Query は「画面 1 つ分」を返す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface FacilityManagementListQuery {
  /**
   * 全施設・設備の一覧を取得する。
   *
   * 並び順:
   * 1. 有効な施設を先に（isActive 降順）
   * 2. 施設名の昇順（name 昇順）
   * 3. 施設 ID の昇順（id 昇順）
   */
  listAll(): ResultAsync<FacilityManagementList, QueryError>;
}
