import { and, eq, lt } from "drizzle-orm";
import { ok, okAsync, ResultAsync } from "neverthrow";

import { reservationReadTable } from "~/db/schema";
import {
  ReservationErrorCode,
  type ReservationError,
  type ReservationReadRepository,
} from "~/domain/reservation";
import type { Database } from "../db";

/**
 * 既読の日時を upsert する文を組み立てる。
 *
 * 既に記録があるときは、渡された時刻のほうが後のときだけ書き換える（setWhere）。
 * 先に開いた画面の書き込みが後から届いても、last_read_at を後ろへは戻さない（INFO-012）。
 */
const upsertReadStatement = (db: Database, userId: string, reservationId: string, readAt: Date) =>
  db
    .insert(reservationReadTable)
    .values({ userId, reservationId, lastReadAt: readAt })
    .onConflictDoUpdate({
      target: [reservationReadTable.userId, reservationReadTable.reservationId],
      set: { lastReadAt: readAt },
      setWhere: lt(reservationReadTable.lastReadAt, readAt),
    });

export const createReservationReadRepository = (db: Database): ReservationReadRepository => ({
  upsert: (userId, reservationId, readAt) =>
    ResultAsync.fromPromise(
      upsertReadStatement(db, userId, reservationId, readAt),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "既読日時の更新に失敗しました。",
        cause: error,
      }),
    ).map(() => undefined),

  upsertMany: (userId, reservationIds, readAt) => {
    const [first, ...rest] = reservationIds.map((reservationId) =>
      upsertReadStatement(db, userId, reservationId, readAt),
    );
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
