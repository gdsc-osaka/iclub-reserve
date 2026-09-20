import { and, eq, gt, lt, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { err, ok, ResultAsync } from "neverthrow";

import { reservationTable } from "~/db/schema";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ApplyStatusTransitionArgs,
  type Reservation,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";
import type { Database } from "../db";

/** 重なりを探すとき、同じ予約テーブルをもう一度読むための別名 */
const overlapping = alias(reservationTable, "overlapping");

export const createReservationRepository = (db: Database): ReservationRepository => {
  /**
   * 承認済みの予約と重なっていないこと（COND-001）を、更新する行自身と突き合わせる条件。
   *
   * `existsApprovedOverlap` と違い、時間帯を引数で受けずに更新対象の行の列を参照する。
   * こうすることで「重なりの確認」と「ステータスの更新」が 1 つの UPDATE 文になり、
   * 2 人の事務局が重なった仮予約を同時に承認しても、あとの 1 件が 0 件更新で弾かれる。
   *
   * 外側（更新される行）は reservationTable、内側（重なりを探す側）は overlapping と、
   * 同じ表を 2 つの名前で参照する。列はどちらも Drizzle の定義から辿るので、
   * 列名を変えたときは SQL ではなく型エラーとして分かる。
   */
  const noApprovedOverlap = notExists(
    db
      .select({ id: overlapping.id })
      .from(overlapping)
      .where(
        and(
          eq(overlapping.facilityId, reservationTable.facilityId),
          eq(overlapping.status, ReservationStatus.Approved),
          ne(overlapping.id, reservationTable.id),
          // 終了時刻は予約に含まれないので、境界がぴったり接する予約は重なりに含めない
          lt(overlapping.startAt, reservationTable.endAt),
          gt(overlapping.endAt, reservationTable.startAt),
        ),
      ),
  );

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

  const applyStatusTransition = (
    args: ApplyStatusTransitionArgs,
  ): ResultAsync<boolean, ReservationError> =>
    ResultAsync.fromPromise(
      db
        .update(reservationTable)
        .set({
          status: args.status,
          statusReason: args.statusReason,
          updatedAt: args.updatedAt,
        })
        .where(
          and(
            eq(reservationTable.id, args.id),
            // 読んだときの状態から変わっていないことを、更新の条件に入れる
            eq(reservationTable.status, args.expectedStatus),
            args.requireNoApprovedOverlap ? noApprovedOverlap : undefined,
          ),
        )
        // 更新できたかを知るために、更新した行の id を返させる（0 件なら競合）
        .returning({ id: reservationTable.id }),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約ステータスの更新に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.length > 0);

  return { findById, create, existsApprovedOverlap, applyStatusTransition };
};
