import type { ResultAsync } from "neverthrow";

import type { HolidayError } from "./error";
import type { HolidayItem } from "./holiday";

/**
 * 祝日データの永続化窓口（ポート）。
 */
export interface HolidayRepository {
  /**
   * 既存の祝日データを全件削除し、与えられた祝日一覧を不可分に入れ直す。
   *
   * @param holidays 保存する祝日一覧
   */
  replaceAll(holidays: readonly HolidayItem[]): ResultAsync<void, HolidayError>;
}
