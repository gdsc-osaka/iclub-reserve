import { and, eq, sql } from "drizzle-orm";
import { ok, okAsync, ResultAsync } from "neverthrow";

import { reservationReadTable } from "~/db/schema";
import {
  ReservationErrorCode,
  type ReservationError,
  type ReservationReadRepository,
} from "~/domain/reservation";
import type { Database } from "../db";

export const createReservationReadRepository = (db: Database): ReservationReadRepository => ({
  upsert: (userId, reservationId, readAt) =>
    ResultAsync.fromPromise(
      db
        .insert(reservationReadTable)
        .values({
          userId,
          reservationId,
          lastReadAt: readAt,
        })
        .onConflictDoUpdate({
          target: [reservationReadTable.userId, reservationReadTable.reservationId],
          set: {
            lastReadAt: sql`MAX(${reservationReadTable.lastReadAt}, excluded.last_read_at)`,
          },
        }),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "既読日時の更新に失敗しました。",
        cause: error,
      }),
    ).map(() => undefined),

  upsertMany: (userId, reservationIds, readAt) => {
    if (reservationIds.length === 0) {
      return okAsync(undefined);
    }

    const statements = reservationIds.map((reservationId) =>
      db
        .insert(reservationReadTable)
        .values({
          userId,
          reservationId,
          lastReadAt: readAt,
        })
        .onConflictDoUpdate({
          target: [reservationReadTable.userId, reservationReadTable.reservationId],
          set: {
            lastReadAt: sql`MAX(${reservationReadTable.lastReadAt}, excluded.last_read_at)`,
          },
        }),
    );

    const [first, ...rest] = statements;
    if (first === undefined) {
      return okAsync(undefined);
    }

    return ResultAsync.fromPromise(db.batch([first, ...rest]), (error): ReservationError => ({
      code: ReservationErrorCode.DatabaseError,
      message: "既読日時の一括更新に失敗しました。",
      cause: error,
    })).map(() => undefined);
  },

  findByUserAndReservation: (userId, reservationId) =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(reservationReadTable)
        .where(
          and(
            eq(reservationReadTable.userId, userId),
            eq(reservationReadTable.reservationId, reservationId),
          ),
        )
        .limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "既読日時の取得に失敗しました。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);
      if (!row) {
        return ok(null);
      }
      return ok({
        userId: row.userId,
        reservationId: row.reservationId,
        lastReadAt: row.lastReadAt,
      });
    }),
});
