import { and, asc, count, eq, gt } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import {
  ReservationStatus,
  STAFF_PENDING_RESERVATIONS_LIMIT,
  isShortNotice,
} from "~/domain/reservation";
import type { Database } from "~/infra/db";
import { hasOverlappingReservation } from "~/infra/reservation/reservation-overlap";
import {
  reservationWithNamesColumns,
  type ReservationWithNames,
} from "../_shared/reservation-with-names";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局のダッシュボード「承認待ちの予約」に並ぶ仮予約 1 件分（SCR-022 / UC-006）。
 */
export interface StaffPendingReservationItem extends ReservationWithNames {
  readonly id: string;
  readonly headCount: number;
  /** 申請日 */
  readonly createdAt: Date;
  /** 同じ施設・時間帯に承認済みの予約があるか。あれば承認できない（COND-001） */
  readonly hasApprovedOverlap: boolean;
  /** 同じ施設・時間帯にほかの仮予約があるか。承認されるのはどちらか一方になる */
  readonly hasProvisionalOverlap: boolean;
}

/**
 * 「承認待ちの予約」1 区画分。
 */
export interface StaffPendingReservations {
  /** 開始日時の近い順に、最大 5 件 */
  readonly items: readonly StaffPendingReservationItem[];
  /** 開始日時が今より後の仮予約の総数 */
  readonly totalCount: number;
  /** うち利用日まで 7 日を切っている数（COND-028） */
  readonly shortNoticeCount: number;
}

export interface FindStaffPendingReservationsArgs {
  /** 事務局かどうか（COND-009）。承認待ちは全団体の予約なので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

export interface CountStaffPendingReservationsArgs {
  /** 事務局かどうか（COND-009）。承認待ちは全団体の予約なので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

/** 承認待ちの仮予約を絞り込む条件（開始日時が今より後の仮予約） */
const staffPendingReservationsWhere = (now: Date) =>
  and(
    eq(reservationTable.status, ReservationStatus.Provisional),
    gt(reservationTable.startAt, now),
  );

/**
 * 開始が近い順に並んだ仮予約から、区画に出す先頭の数件と、その件数を数える。
 *
 * @param rows 開始日時が `now` より後の仮予約すべて（開始日時の近い順）
 */
export const toStaffPendingReservations = (
  rows: readonly StaffPendingReservationItem[],
  now: Date,
): StaffPendingReservations => ({
  items: rows.slice(0, STAFF_PENDING_RESERVATIONS_LIMIT),
  totalCount: rows.length,
  shortNoticeCount: rows.filter((row) => isShortNotice(row.startAt, now)).length,
});

/**
 * 事務局のダッシュボードの「承認待ちの予約」と、その件数を取得する（SCR-022 / UC-006）。
 *
 * 件数を数えるために、表示する 5 件より多く読む。承認を待っている仮予約は
 * 多くても数十件なので、件数用の問い合わせを別に投げるより 1 回で読む方をとる。
 */
export const findStaffPendingReservations = (
  db: Database,
  args: FindStaffPendingReservationsArgs,
): ResultAsync<StaffPendingReservations, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が、承認待ちの仮予約を取得しようとした。");

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: reservationTable.id,
          ...reservationWithNamesColumns,
          headCount: reservationTable.headCount,
          createdAt: reservationTable.createdAt,
          hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
          hasProvisionalOverlap: hasOverlappingReservation(db, ReservationStatus.Provisional),
        })
        .from(reservationTable)
        .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
        .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
        .where(staffPendingReservationsWhere(args.now))
        .orderBy(asc(reservationTable.startAt), asc(reservationTable.id)),
      wrapError(QueryErrorCode.DatabaseError, "承認待ちの仮予約の取得に失敗しました。"),
    );

    return ok(toStaffPendingReservations(rows, args.now));
  });

/**
 * 承認待ちの仮予約の件数を数える（SCR-022 / UC-006、ナビゲーションのバッジ）。
 */
export const countStaffPendingReservations = (
  db: Database,
  args: CountStaffPendingReservationsArgs,
): ResultAsync<number, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が、承認待ちの仮予約を数えようとした。");

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({ count: count() })
        .from(reservationTable)
        .where(staffPendingReservationsWhere(args.now)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "承認待ちの仮予約の件数の取得に失敗しました。",
        cause: error,
      }),
    );

    return ok(rows.at(0)?.count ?? 0);
  });
