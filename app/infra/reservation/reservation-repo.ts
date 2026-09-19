import { and, eq, gt, lt } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";

import { reservationTable } from "~/db/schema";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
  type UpdateReservationStatusArgs,
} from "~/domain/reservation";
import type { Database } from "../db";

export const createReservationRepository = (db: Database): ReservationRepository => {
  const findById = (id: string): ResultAsync<Reservation, ReservationError> => {
    return ResultAsync.fromPromise(
      db.select().from(reservationTable).where(eq(reservationTable.id, id)).limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "Failed to query the database",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: ReservationErrorCode.ReservationNotFound,
          message: "Reservation not Found",
        });
      }

      return ok(row);
    });
  };

  const create = (reservation: Reservation): ResultAsync<null, ReservationError> => {
    return ResultAsync.fromPromise(
      db.insert(reservationTable).values(reservation),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "Failed to insert reservation",
        cause: error,
      }),
    ).map(() => null);
  };

  /**
   * 重なっている承認済みの予約を 1 件だけ探す（COND-001）。
   *
   * 件数は要らないので `limit(1)` で打ち切る。重複が 1 件でもあれば申請を止めるため、
   * 何件あるかを数えても使い道がない。
   */
  const existsApprovedOverlap = (
    args: ReservationOverlapArgs,
  ): ResultAsync<boolean, ReservationError> =>
    ResultAsync.fromPromise(
      db
        .select({ id: reservationTable.id })
        .from(reservationTable)
        .where(
          and(
            eq(reservationTable.facilityId, args.facilityId),
            eq(reservationTable.status, ReservationStatus.Approved),
            // 終了時刻は予約に含まれないので、境界がぴったり接する予約は重なりに含めない
            lt(reservationTable.startAt, args.endAt),
            gt(reservationTable.endAt, args.startAt),
          ),
        )
        .limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "重複する予約の確認に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.length > 0);

  const updateStatus = (args: UpdateReservationStatusArgs): ResultAsync<null, ReservationError> =>
    ResultAsync.fromPromise(
      db
        .update(reservationTable)
        .set({
          status: args.status,
          statusReason: args.statusReason,
          updatedAt: args.updatedAt,
        })
        .where(eq(reservationTable.id, args.id)),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約ステータスの更新に失敗しました。",
        cause: error,
      }),
    ).map(() => null);

  return { findById, create, existsApprovedOverlap, updateStatus };
};
