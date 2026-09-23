import { and, count, eq, gt, notExists, or } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import { facilityTable, reservationTable } from "~/db/schema";
import {
  FacilityErrorCode,
  type CreateFacilityInput,
  type Facility,
  type FacilityError,
  type FacilityRepository,
  type UpdateFacilityActiveStatusInput,
  type UpdateFacilityInput,
} from "~/domain/facility";
import { ReservationStatus } from "~/domain/reservation";
import type { Database } from "../db";

const toFacility = (row: typeof facilityTable.$inferSelect): Facility => ({
  id: row.id,
  name: row.name,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  description: row.description,
  photoUrl: row.photoUrl,
  googleCalendarId: row.googleCalendarId,
  calendarUrl: row.calendarUrl,
});

export const createFacilityRepository = (db: Database): FacilityRepository => {
  const findById = (id: string): ResultAsync<Facility, FacilityError> =>
    ResultAsync.fromPromise(
      db.select().from(facilityTable).where(eq(facilityTable.id, id)).limit(1),
      (error): FacilityError => ({
        code: FacilityErrorCode.DatabaseError,
        message: "施設テーブルを読み取れなかった。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: FacilityErrorCode.NotFound,
          message: `施設 ${id} が見つからない。`,
        });
      }

      return ok(toFacility(row));
    });

  const create = (input: CreateFacilityInput): ResultAsync<Facility, FacilityError> =>
    ResultAsync.fromPromise(
      db
        .insert(facilityTable)
        .values({
          name: input.name,
          description: input.description,
          photoUrl: input.photoUrl,
          googleCalendarId: input.googleCalendarId,
          calendarUrl: input.calendarUrl,
          isActive: input.isActive,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .returning(),
      (error): FacilityError => ({
        code: FacilityErrorCode.DatabaseError,
        message: "施設テーブルに登録できなかった。",
        cause: error,
      }),
    ).map((rows) => toFacility(rows[0]));

  const update = (input: UpdateFacilityInput): ResultAsync<Facility, FacilityError> =>
    ResultAsync.fromPromise(
      db
        .update(facilityTable)
        .set({
          name: input.name,
          description: input.description,
          photoUrl: input.photoUrl,
          googleCalendarId: input.googleCalendarId,
          calendarUrl: input.calendarUrl,
          updatedAt: input.updatedAt,
        })
        .where(eq(facilityTable.id, input.id))
        .returning(),
      (error): FacilityError => ({
        code: FacilityErrorCode.DatabaseError,
        message: "施設テーブルを更新できなかった。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row === undefined) {
        return err({
          code: FacilityErrorCode.NotFound,
          message: `施設 ${input.id} が見つからない。`,
        });
      }
      return ok(toFacility(row));
    });

  /*
   * NOTE: この SQL 条件は app/domain/facility/deactivation.ts の
   * isBlockingReservation を書き写したものである。片方を変えたらもう片方も必ず直すこと。
   */
  const countBlockingReservations = (
    facilityId: string,
    now: Date,
  ): ResultAsync<number, FacilityError> =>
    ResultAsync.fromPromise(
      db
        .select({ count: count() })
        .from(reservationTable)
        .where(
          and(
            eq(reservationTable.facilityId, facilityId),
            or(
              and(
                eq(reservationTable.status, ReservationStatus.Provisional),
                gt(reservationTable.endAt, now),
              ),
              and(
                eq(reservationTable.status, ReservationStatus.Approved),
                gt(reservationTable.startAt, now),
              ),
            ),
          ),
        ),
      (error): FacilityError => ({
        code: FacilityErrorCode.DatabaseError,
        message: "予約テーブルの件数を読み取れなかった。",
        cause: error,
      }),
    ).map((rows) => rows.at(0)?.count ?? 0);

  /*
   * NOTE: この SQL 条件は app/domain/facility/deactivation.ts の
   * isBlockingReservation を書き写したものである。片方を変えたらもう片方も必ず直すこと。
   */
  const updateActiveStatus = ({
    id,
    from,
    to,
    updatedAt,
    now,
  }: UpdateFacilityActiveStatusInput): ResultAsync<Facility, FacilityError> => {
    const hasNoBlockingReservations = notExists(
      db
        .select({ id: reservationTable.id })
        .from(reservationTable)
        .where(
          and(
            eq(reservationTable.facilityId, id),
            or(
              and(
                eq(reservationTable.status, ReservationStatus.Provisional),
                gt(reservationTable.endAt, now),
              ),
              and(
                eq(reservationTable.status, ReservationStatus.Approved),
                gt(reservationTable.startAt, now),
              ),
            ),
          ),
        ),
    );

    const updateWhere = and(
      eq(facilityTable.id, id),
      eq(facilityTable.isActive, from),
      to ? undefined : hasNoBlockingReservations,
    );

    return ResultAsync.fromPromise(
      db
        .update(facilityTable)
        .set({
          isActive: to,
          updatedAt,
        })
        .where(updateWhere)
        .returning(),
      (error): FacilityError => ({
        code: FacilityErrorCode.DatabaseError,
        message: "施設ステータスを更新できなかった。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row === undefined) {
        return err({
          code: FacilityErrorCode.InvalidTransition,
          message: `施設 ${id} の状態更新（${from} -> ${to}）に失敗した。`,
          userMessage: "施設の状態が変わっています。画面を読み込み直してください。",
        });
      }
      return ok(toFacility(row));
    });
  };

  return {
    findById,
    create,
    update,
    countBlockingReservations,
    updateActiveStatus,
  };
};
