import type { ResultAsync } from "neverthrow";

import type { QueryError } from "~/query/error";

/**
 * 祝日データの読み取り専用の窓口（ポート）。
 */
export interface HolidayQuery {
  /**
   * 指定した期間内（from〜to、両端を含む）の祝日の日付（"YYYY-MM-DD"）の一覧を返す。
   * 日付の昇順で並べる。
   *
   * @param from 開始日（"YYYY-MM-DD"、この日を含む）
   * @param to 終了日（"YYYY-MM-DD"、この日を含む）
   */
  findHolidaysBetween(from: string, to: string): ResultAsync<readonly string[], QueryError>;
}
