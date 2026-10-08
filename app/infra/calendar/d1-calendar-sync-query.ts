import { inArray, eq } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";

import { facilityTable, reservationTable } from "~/db/schema";
import type { ReservationStatus } from "~/domain/reservation";
import type {
  CalendarSyncQuery,
  CalendarSyncReservationState,
  FacilityCalendarId,
} from "~/query/calendar/calendar-sync-query";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { Database } from "../db";

const toDatabaseError =
  (message: string) =>
  (error: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause: error,
  });

/**
 * Cloudflare D1 (Drizzle) を使った CalendarSyncQuery の実装。
 *
 * 予約と施設を 1 回の問い合わせで結合し、同期に必要な情報を取得する。
 */
export const createD1CalendarSyncQuery = (db: Database): CalendarSyncQuery => ({
  fetchReservationStates: (reservationIds) => {
    const uniqueIds = [...new Set(reservationIds)];
    if (uniqueIds.length === 0) {
      return okAsync([] as readonly CalendarSyncReservationState[]);
    }

    const query = db
      .select({
        id: reservationTable.id,
        status: reservationTable.status,
        facilityId: reservationTable.facilityId,
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
        facilityTableId: facilityTable.id,
        facilityName: facilityTable.name,
        facilityGoogleCalendarId: facilityTable.googleCalendarId,
      })
      .from(reservationTable)
      .leftJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
      .where(inArray(reservationTable.id, uniqueIds));

    return ResultAsync.fromPromise(
      query,
      toDatabaseError("カレンダー同期用予約状態の取得に失敗しました。"),
    ).map((rows): readonly CalendarSyncReservationState[] =>
      rows.map((row) => ({
        id: row.id,
        status: row.status as ReservationStatus,
        facilityId: row.facilityId,
        startAt: row.startAt,
        endAt: row.endAt,
        facility:
          row.facilityTableId !== null && row.facilityName !== null
            ? {
                name: row.facilityName,
                googleCalendarId: row.facilityGoogleCalendarId,
              }
            : null,
      })),
    );
  },

  fetchFacilityCalendarIds: (facilityIds) => {
    const uniqueIds = [...new Set(facilityIds)];
    if (uniqueIds.length === 0) {
      return okAsync([] as readonly FacilityCalendarId[]);
    }

    const query = db
      .select({
        id: facilityTable.id,
        googleCalendarId: facilityTable.googleCalendarId,
      })
      .from(facilityTable)
      .where(inArray(facilityTable.id, uniqueIds));

    return ResultAsync.fromPromise(
      query,
      toDatabaseError("施設カレンダーIDの取得に失敗しました。"),
    ).map((rows): readonly FacilityCalendarId[] =>
      rows.map((row) => ({
        id: row.id,
        googleCalendarId: row.googleCalendarId,
      })),
    );
  },
});
