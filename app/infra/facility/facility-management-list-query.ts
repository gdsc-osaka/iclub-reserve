import { asc, desc } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  FacilityManagementItem,
  FacilityManagementList,
  FacilityManagementListQuery,
} from "~/query/facility/facility-management-list";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った FacilityManagementListQuery の実装。
 */
export const createFacilityManagementListQuery = (db: Database): FacilityManagementListQuery => ({
  listAll: (): ResultAsync<FacilityManagementList, QueryError> =>
    ResultAsync.fromPromise(
      db
        .select({
          id: facilityTable.id,
          name: facilityTable.name,
          description: facilityTable.description,
          photoUrl: facilityTable.photoUrl,
          googleCalendarId: facilityTable.googleCalendarId,
          isActive: facilityTable.isActive,
          updatedAt: facilityTable.updatedAt,
        })
        .from(facilityTable)
        /*
         * 並び順:
         * 1. 有効な施設を先に（isActive 降順: true=1, false=0）
         * 2. 施設名の昇順
         * 3. 施設 ID の昇順
         */
        .orderBy(desc(facilityTable.isActive), asc(facilityTable.name), asc(facilityTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "施設一覧を読み取れなかった。",
        cause: error,
      }),
    ).map((rows): FacilityManagementList =>
      rows.map((row): FacilityManagementItem => ({
        id: row.id,
        name: row.name,
        description: row.description,
        photoUrl: row.photoUrl,
        isActive: row.isActive,
        hasGoogleCalendar: row.googleCalendarId !== null && row.googleCalendarId.trim() !== "",
        updatedAt: row.updatedAt,
      })),
    ),
});
