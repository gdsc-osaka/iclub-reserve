import { and, asc, gte, lte } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { holidayTable } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { HolidayQuery } from "~/query/holiday";
import type { Database } from "../db";

const toDatabaseError =
  (message: string) =>
  (cause: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause,
  });

/**
 * Cloudflare D1 を使った HolidayQuery の実装を作成する。
 */
export const createD1HolidayQuery = (db: Database): HolidayQuery => ({
  findHolidaysBetween: (from: string, to: string): ResultAsync<readonly string[], QueryError> => {
    const query = db
      .select({ date: holidayTable.date })
      .from(holidayTable)
      .where(and(gte(holidayTable.date, from), lte(holidayTable.date, to)))
      .orderBy(asc(holidayTable.date));

    return ResultAsync.fromPromise(query, toDatabaseError("祝日一覧の取得に失敗しました。")).map(
      (rows) => rows.map((row) => row.date),
    );
  },
});
