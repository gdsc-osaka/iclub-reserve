import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { calendarVisibleStatuses, type ReservationStatus } from "~/domain/reservation";
import type { Database } from "~/infra/db";
import { addDays, startOfTokyoDay } from "~/lib/date";
import {
  reservationWithNamesColumns,
  type ReservationWithNames,
} from "../_shared/reservation-with-names";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 「今日の予約状況」に行として並べる、有効な施設・設備。
 */
export interface TodayScheduleFacility {
  readonly id: string;
  readonly name: string;
}

/**
 * 「今日の予約状況」に描く予約 1 件分（UC-001 / SCR-022）。
 *
 * 見るのは事務局だけなので、他団体の予約も全項目を渡す（COND-008・COND-009）。
 */
export interface TodayScheduleReservation extends ReservationWithNames {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly headCount: number;
}

/**
 * 事務局のダッシュボードの「今日の予約状況」1 区画分。
 */
export interface StaffTodaySchedule {
  readonly facilities: readonly TodayScheduleFacility[];
  readonly reservations: readonly TodayScheduleReservation[];
}

export interface FindStaffTodayScheduleArgs {
  /** 事務局かどうか（COND-009）。全団体の予約を見るので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

/**
 * 有効な施設・設備すべてと、`now` の日（日本時間）にかかる承認済み・仮予約を取得する（UC-001 / SCR-022）。
 *
 * 空き状況の画面（facility-availability-calendar.ts）は施設 1 つ分を取る作りで、全施設分を取るには
 * 施設の数だけ問い合わせを繰り返すことになる。ダッシュボードは全施設の 1 日分だけが要るので、
 * 施設と予約をそれぞれ 1 回で読む。
 */
export const findStaffTodaySchedule = (
  db: Database,
  args: FindStaffTodayScheduleArgs,
): ResultAsync<StaffTodaySchedule, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が、今日の予約状況を取得しようとした。");

    const dayStart = startOfTokyoDay(args.now);
    const dayEnd = startOfTokyoDay(addDays(args.now, 1));

    const facilitiesQuery = db
      .select({
        id: facilityTable.id,
        name: facilityTable.name,
      })
      .from(facilityTable)
      .where(eq(facilityTable.isActive, true))
      .orderBy(asc(facilityTable.name), asc(facilityTable.id));

    const reservationsQuery = db
      .select({
        id: reservationTable.id,
        ...reservationWithNamesColumns,
        status: reservationTable.status,
        headCount: reservationTable.headCount,
      })
      .from(reservationTable)
      .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
      .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
      .where(
        and(
          eq(facilityTable.isActive, true),
          // 取り消し・却下・キャンセルで終わった予約は、その時間帯を使わないので描かない
          inArray(reservationTable.status, calendarVisibleStatuses),
          // 今日の 0 時〜24 時に少しでもかかる予約（前日から続くもの・翌日まで続くものも含む）
          lt(reservationTable.startAt, dayEnd),
          gt(reservationTable.endAt, dayStart),
        ),
      )
      .orderBy(asc(reservationTable.startAt), asc(reservationTable.id));

    const [facilities, reservations] = yield* ResultAsync.fromPromise(
      Promise.all([facilitiesQuery, reservationsQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "今日の予約状況の取得に失敗しました。",
        cause: error,
      }),
    );

    return ok({ facilities, reservations });
  });
