import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { calendarVisibleStatuses } from "~/domain/reservation";
import { addDays, startOfTokyoDay } from "~/lib/date";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  StaffTodayScheduleQuery,
  StaffTodayScheduleResult,
} from "~/query/reservation/staff-today-schedule";
import type { Database } from "../db";

/*
 * 空き状況のユースケース（get-availability-calendar.ts）は施設 1 つ分を取る作りで、全施設分を取るには
 * 施設の数だけ問い合わせを繰り返すことになる。ダッシュボードは全施設の 1 日分だけが要るので、
 * 施設と予約をそれぞれ 1 回で読む。
 */
export const createStaffTodayScheduleQuery = (db: Database): StaffTodayScheduleQuery => ({
  findTodaySchedule: (now: Date) => {
    const dayStart = startOfTokyoDay(now);
    const dayEnd = startOfTokyoDay(addDays(now, 1));

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
        groupId: reservationTable.groupId,
        groupName: groupTable.name,
        facilityId: reservationTable.facilityId,
        facilityName: facilityTable.name,
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
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

    return ResultAsync.fromPromise(
      Promise.all([facilitiesQuery, reservationsQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "今日の予約状況の取得に失敗しました。",
        cause: error,
      }),
    ).map(([facilities, reservations]): StaffTodayScheduleResult => ({ facilities, reservations }));
  },
});
