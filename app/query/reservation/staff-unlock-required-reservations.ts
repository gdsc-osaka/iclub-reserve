import { and, asc, eq, gt } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import {
  ReservationStatus,
  STAFF_UNLOCK_REQUIRED_RESERVATIONS_LIMIT,
  UnlockArrangement,
} from "~/domain/reservation";
import type { Database } from "~/infra/db";
import {
  reservationWithNamesColumns,
  type ReservationWithNames,
} from "../_shared/reservation-with-names";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局のダッシュボード「解錠の手配が要る予約」に並ぶ予約 1 件分（SCR-022 (4) / COND-027 (4)）。
 */
export interface StaffUnlockRequiredReservationItem extends ReservationWithNames {
  readonly id: string;
}

/**
 * 「解錠の手配が要る予約」1 区画分。
 */
export interface StaffUnlockRequiredReservations {
  /** 開始日時の近い順に、最大 5 件 */
  readonly items: readonly StaffUnlockRequiredReservationItem[];
  /** 終了日時が今より後の要手配の予約の総数 */
  readonly totalCount: number;
}

export interface FindStaffUnlockRequiredReservationsArgs {
  /** 事務局かどうか（COND-009）。解錠の手配が要る予約は全団体の予約なので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

/**
 * 開始が近い順に並んだ要手配の予約から、区画に出す先頭の数件と、対象全体の件数を数える。
 *
 * @param rows 終了日時が `now` より後の要手配の承認済み予約すべて（開始日時の近い順）
 */
export const toStaffUnlockRequiredReservations = (
  rows: readonly StaffUnlockRequiredReservationItem[],
): StaffUnlockRequiredReservations => ({
  items: rows.slice(0, STAFF_UNLOCK_REQUIRED_RESERVATIONS_LIMIT),
  totalCount: rows.length,
});

/**
 * 事務局のダッシュボードの「解錠の手配が要る予約」と、その件数を取得する（SCR-022 (4) / COND-027 (4)）。
 *
 * 承認済みで、利用の終了日時が `now` より後、かつ解錠の手配が「要手配」の予約を、
 * 開始日時の近い順に取得する。
 */
export const findStaffUnlockRequiredReservations = (
  db: Database,
  args: FindStaffUnlockRequiredReservationsArgs,
): ResultAsync<StaffUnlockRequiredReservations, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(
      args.isStaff,
      "事務局ではない人が、解錠の手配が要る予約を取得しようとした。",
    );

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: reservationTable.id,
          ...reservationWithNamesColumns,
        })
        .from(reservationTable)
        .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
        .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
        .where(
          and(
            eq(reservationTable.status, ReservationStatus.Approved),
            gt(reservationTable.endAt, args.now),
            eq(reservationTable.unlockArrangement, UnlockArrangement.Required),
          ),
        )
        .orderBy(asc(reservationTable.startAt), asc(reservationTable.id)),
      wrapError(QueryErrorCode.DatabaseError, "解錠の手配が要る予約の取得に失敗しました。"),
    );

    return ok(toStaffUnlockRequiredReservations(rows));
  });
