import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import {
  facilityTable,
  groupCalendarFeedTable,
  groupMemberTable,
  groupTable,
  reservationTable,
} from "~/db/schema";
import { type GroupCalendarReservation } from "~/domain/calendar/group-calendar-feed";
import { wrapError } from "~/domain/error";
import { calendarVisibleStatuses } from "~/domain/reservation";
import type { Database } from "~/infra/db";
import { QueryErrorCode, type QueryError } from "~/query/error";

/**
 * トークンに紐づく自団体のカレンダー配信データ。
 */
export interface GroupCalendarFeed {
  readonly groupId: string;
  readonly groupName: string;
  readonly reservations: readonly GroupCalendarReservation[];
}

export interface FindGroupCalendarFeedArgs {
  /** 購読 URL に含まれる秘密のトークン */
  readonly token: string;
  /** 予約の終了日時の下限（これより後に終了する予約のみ含める） */
  readonly since: Date;
}

/**
 * トークンから自団体の予約一覧を取得する（ADR-013 決定 4・5 / COND-029）。
 *
 * 1. トークンから購読行・所属（group_member）・団体を結合して取得。
 *    存在しない・所属が削除された場合は null を返す（エラーにはしない）。
 * 2. 該当団体の予約のうち、仮予約・承認済みで終了日時が since より後のものを取得する。
 */
export const findGroupCalendarFeed = (
  db: Database,
  args: FindGroupCalendarFeedArgs,
): ResultAsync<GroupCalendarFeed | null, QueryError> =>
  safeTry(async function* () {
    const feedRows = yield* ResultAsync.fromPromise(
      db
        .select({
          groupId: groupTable.id,
          groupName: groupTable.name,
        })
        .from(groupCalendarFeedTable)
        .innerJoin(groupMemberTable, eq(groupCalendarFeedTable.membershipId, groupMemberTable.id))
        .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
        .where(eq(groupCalendarFeedTable.token, args.token))
        .limit(1),
      wrapError(QueryErrorCode.DatabaseError, "カレンダー購読情報の読み取りに失敗しました。"),
    );

    const feed = feedRows.at(0);
    if (feed === undefined) {
      return ok(null);
    }

    const reservations = yield* ResultAsync.fromPromise(
      db
        .select({
          id: reservationTable.id,
          status: reservationTable.status,
          facilityName: facilityTable.name,
          headCount: reservationTable.headCount,
          remarks: reservationTable.note,
          startAt: reservationTable.startAt,
          endAt: reservationTable.endAt,
          updatedAt: reservationTable.updatedAt,
          facilityUpdatedAt: facilityTable.updatedAt,
        })
        .from(reservationTable)
        .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
        .where(
          and(
            eq(reservationTable.groupId, feed.groupId),
            inArray(reservationTable.status, calendarVisibleStatuses),
            gt(reservationTable.endAt, args.since),
          ),
        )
        .orderBy(asc(reservationTable.startAt), asc(reservationTable.id)),
      wrapError(
        QueryErrorCode.DatabaseError,
        "カレンダー配信用の予約一覧の読み取りに失敗しました。",
      ),
    );

    return ok({
      groupId: feed.groupId,
      groupName: feed.groupName,
      reservations,
    });
  });
