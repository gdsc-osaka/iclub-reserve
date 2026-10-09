import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";

import { facilityTable, reservationTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import type {
  CalendarReconcileFacility,
  CalendarReconcileQuery,
  CalendarReconcileReservation,
} from "~/query/calendar/calendar-reconcile-query";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { Database } from "../db";

const toDatabaseError =
  (message: string) =>
  (error: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause: error,
  });

/** D1 の 1 クエリあたりバインド変数上限（100個）を下回るようにするための IN 句チャンクサイズ */
const FACILITY_IDS_CHUNK_SIZE = 90;

/**
 * Cloudflare D1 (Drizzle) を使った CalendarReconcileQuery の実装。
 */
export const createD1CalendarReconcileQuery = (db: Database): CalendarReconcileQuery => ({
  fetchTargetFacilities: () => {
    const query = db
      .select({
        id: facilityTable.id,
        name: facilityTable.name,
        googleCalendarId: facilityTable.googleCalendarId,
      })
      .from(facilityTable)
      .where(
        and(isNotNull(facilityTable.googleCalendarId), ne(facilityTable.googleCalendarId, "")),
      );

    return ResultAsync.fromPromise(
      query,
      toDatabaseError("突き合わせ対象施設の取得に失敗しました。"),
    ).map((rows): readonly CalendarReconcileFacility[] =>
      rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          googleCalendarId: row.googleCalendarId?.trim() ?? "",
        }))
        .filter((facility) => facility.googleCalendarId !== ""),
    );
  },

  fetchApprovedReservations: (facilityIds, rangeStart) => {
    const uniqueFacilityIds = [
      ...new Set(facilityIds.map((id) => id.trim()).filter((id) => id !== "")),
    ];
    if (uniqueFacilityIds.length === 0) {
      return okAsync([] as readonly CalendarReconcileReservation[]);
    }

    // 施設 ID 配列が D1 の 100 変数上限を超えないよう、チャンクに分割して問い合わせる
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueFacilityIds.length; i += FACILITY_IDS_CHUNK_SIZE) {
      chunks.push(uniqueFacilityIds.slice(i, i + FACILITY_IDS_CHUNK_SIZE));
    }

    const queries = chunks.map((chunk) => {
      // 境界の扱い: DB 側は end_at >= rangeStart、Google 側は timeMin=endAfter (end > rangeStart) となるが、
      // 施設の利用時間は 9〜21 時のため 0 時ちょうどに終わる予約は存在せず、両者で対象範囲に食い違いは生じない。
      return db
        .select({
          id: reservationTable.id,
          facilityId: reservationTable.facilityId,
          startAt: reservationTable.startAt,
          endAt: reservationTable.endAt,
        })
        .from(reservationTable)
        .where(
          and(
            inArray(reservationTable.facilityId, chunk),
            eq(reservationTable.status, ReservationStatus.Approved),
            gte(reservationTable.endAt, rangeStart),
          ),
        );
    });

    return ResultAsync.fromPromise(
      Promise.all(queries).then((results) => results.flat()),
      toDatabaseError("突き合わせ対象予約の取得に失敗しました。"),
    ).map((rows): readonly CalendarReconcileReservation[] =>
      rows.map((row) => ({
        id: row.id,
        facilityId: row.facilityId,
        startAt: row.startAt,
        endAt: row.endAt,
      })),
    );
  },
});
