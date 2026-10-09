import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/**
 * カレンダー一覧・購読ページ（SCR-010 / UC-018）で表示する施設・設備の 1 件。
 */
export interface FacilityCalendarSubscriptionItem {
  readonly id: string;
  readonly name: string;
  readonly googleCalendarId: string | null;
  readonly calendarUrl: string | null;
}

/** カレンダー購読用施設一覧の配列 */
export type FacilityCalendarSubscriptionList = readonly FacilityCalendarSubscriptionItem[];

/**
 * カレンダー購読用施設一覧の読み取り専用窓口（Query ポート / ADR-001）。
 *
 * Repository が「集約 1 件」を返すのに対し、Query は「画面 1 つ分」を返す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface FacilityCalendarSubscriptionListQuery {
  /**
   * 有効な施設・設備の一覧をカレンダー購読用に取得する。
   *
   * 並び順:
   * 1. 施設名の昇順（name 昇順）
   * 2. 施設 ID の昇順（id 昇順）
   * （空き状況カレンダーなどの他の有効施設一覧と同じ並び順）
   */
  listActive(): ResultAsync<FacilityCalendarSubscriptionList, QueryError>;
}
