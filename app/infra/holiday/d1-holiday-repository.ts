import { ResultAsync } from "neverthrow";

import { holidayTable } from "~/db/schema";
import {
  HolidayErrorCode,
  type HolidayError,
  type HolidayItem,
  type HolidayRepository,
} from "~/domain/holiday";
import type { Database } from "../db";

/** D1 の 1 文あたりバインド変数上限（100個）に収めるため、INSERT を 50 行以下に分割する */
const INSERT_CHUNK_SIZE = 50;

/** 配列を指定したサイズごとに分割する純粋関数 */
const chunkArray = <T>(array: readonly T[], size: number): readonly (readonly T[])[] => {
  const chunks: (readonly T[])[] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Cloudflare D1 を使った HolidayRepository の実装を作成する。
 *
 * 祝日一覧の入れ替えは 1 回の `db.batch()` 内で不可分に行い、
 * 既存データの全件削除と新しいデータの分割 INSERT を実行する。
 */
export const createD1HolidayRepository = (db: Database): HolidayRepository => ({
  replaceAll: (holidays: readonly HolidayItem[]): ResultAsync<void, HolidayError> =>
    ResultAsync.fromPromise(
      (async () => {
        const insertStmts = chunkArray(holidays, INSERT_CHUNK_SIZE).map((chunk) =>
          db.insert(holidayTable).values(
            chunk.map((item) => ({
              date: item.date,
              name: item.name,
            })),
          ),
        );

        // 1 回の batch で全件削除と分割 INSERT を不可分に流す
        await db.batch([db.delete(holidayTable), ...insertStmts]);
      })(),
      (cause): HolidayError => ({
        code: HolidayErrorCode.DatabaseError,
        message: "祝日テーブルの更新に失敗しました。",
        cause,
      }),
    ),
});
