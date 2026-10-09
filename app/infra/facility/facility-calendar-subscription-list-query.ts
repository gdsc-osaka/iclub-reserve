import { asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  FacilityCalendarSubscriptionItem,
  FacilityCalendarSubscriptionList,
  FacilityCalendarSubscriptionListQuery,
} from "~/query/facility/facility-calendar-subscription-list";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った FacilityCalendarSubscriptionListQuery の実装。
 */
export const createFacilityCalendarSubscriptionListQuery = (
  db: Database,
): FacilityCalendarSubscriptionListQuery => ({
  listActive: (): ResultAsync<FacilityCalendarSubscriptionList, QueryError> =>
    ResultAsync.fromPromise(
      db
        .select({
          id: facilityTable.id,
          name: facilityTable.name,
          googleCalendarId: facilityTable.googleCalendarId,
          calendarUrl: facilityTable.calendarUrl,
        })
        .from(facilityTable)
        .where(eq(facilityTable.isActive, true))
        /*
         * 並び順:
         * 1. 施設名の昇順
         * 2. 施設 ID の昇順
         * （同名の施設があっても並びが入れ替わらないよう、主キーを第 2 キーにする）
         */
        .orderBy(asc(facilityTable.name), asc(facilityTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "カレンダー購読用の施設一覧を読み取れなかった。",
        cause: error,
      }),
    ).map((rows): FacilityCalendarSubscriptionList =>
      rows.map((row): FacilityCalendarSubscriptionItem => ({
        id: row.id,
        name: row.name,
        googleCalendarId: row.googleCalendarId,
        calendarUrl: row.calendarUrl,
      })),
    ),
});
