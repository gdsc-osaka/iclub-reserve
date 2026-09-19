import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { err, ok, ResultAsync, type Result } from "neverthrow";

import { facilityTable, organization, reservationTable } from "~/db/schema";
import { calendarVisibleStatuses } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  AvailabilityFacility,
  FacilityAvailabilityCalendar,
  FacilityAvailabilityCalendarQuery,
} from "~/query/facility/facility-availability-calendar";
import type { Database } from "../db";

/** DB アクセスの失敗を Query のエラーに変える */
const toDatabaseError =
  (message: string) =>
  (error: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause: error,
  });

/**
 * 切り替えに出す施設・設備の一覧を取る。
 *
 * 無効な施設（`is_active = false`）を外しているのは、
 * これから予約できない施設の空き状況を見ても意味がないため。
 * 無効化には将来の予約がすべて終了していることが条件なので（COND-003）、
 * 外したせいで見えなくなる予約は無い。
 */
const selectFacilities = (db: Database) =>
  db
    .select({
      id: facilityTable.id,
      name: facilityTable.name,
      description: facilityTable.description,
    })
    .from(facilityTable)
    .where(eq(facilityTable.isActive, true))
    /*
     * 同名の施設があっても並びが入れ替わらないよう、主キーを第 2 キーにする。
     * 施設名には一意制約がなく、名前だけで並べると同名どうしの順序を SQL が保証しない。
     */
    .orderBy(asc(facilityTable.name), asc(facilityTable.id));

/**
 * 指定した施設の、期間と重なる予約を取る。
 *
 * 重なりの条件が `開始 < 期間の終わり` かつ `終わり > 期間の始まり` なのは、
 * 期間をまたぐ予約も拾うため。「開始日時が期間の中にあるもの」だけを条件にすると、
 * 前の週から続いている予約が消えて、空いているように見えてしまう。
 *
 * 団体名は結合で一緒に取る。予約の件数だけ団体を引き直すと、
 * その回数だけ D1 との往復が増える（N+1 問題）。
 */
const selectReservations = (db: Database, facilityId: string, from: Date, to: Date) =>
  db
    .select({
      id: reservationTable.id,
      groupId: reservationTable.groupId,
      groupName: organization.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      status: reservationTable.status,
      headCount: reservationTable.headCount,
      note: reservationTable.note,
    })
    .from(reservationTable)
    .innerJoin(organization, eq(reservationTable.groupId, organization.id))
    .where(
      and(
        eq(reservationTable.facilityId, facilityId),
        // 終了した予約は描かない。理由は calendarVisibleStatuses の説明を参照
        inArray(reservationTable.status, [...calendarVisibleStatuses]),
        lt(reservationTable.startAt, to),
        gt(reservationTable.endAt, from),
      ),
    )
    .orderBy(asc(reservationTable.startAt), asc(reservationTable.id));

/**
 * 一覧の中から、表示する施設を 1 件選ぶ。
 *
 * `facilityId` が null（＝画面を開いた直後でまだ選んでいない）のときは先頭を使う。
 * URL を直接書き換えて存在しない ID を渡された場合は、
 * 黙って先頭に戻さず NOT_FOUND にする。戻してしまうと、
 * 共有されたリンクが別の施設を指していても気づけない。
 */
const pickFacility = (
  facilities: readonly AvailabilityFacility[],
  facilityId: string | null,
): Result<AvailabilityFacility, QueryError> => {
  if (facilityId === null) {
    const first = facilities.at(0);

    return first === undefined
      ? err({
          code: QueryErrorCode.NotFound,
          message: "表示できる施設・設備がありません。",
        })
      : ok(first);
  }

  const found = facilities.find((facility) => facility.id === facilityId);

  return found === undefined
    ? err({
        code: QueryErrorCode.NotFound,
        message: `ID が ${facilityId} の施設・設備は見つかりませんでした。`,
      })
    : ok(found);
};

/**
 * Cloudflare D1 (Drizzle) を使った FacilityAvailabilityCalendarQuery の実装。
 *
 * 施設の一覧を取ってから予約を取る、という 2 回の問い合わせに分けている。
 * `facilityId` が null のときに「どの施設を表示するか」が
 * 一覧を見るまで決まらないため、1 回にまとめられない。
 * 予約の件数に関係なく必ず 2 回で済むので、N+1 にはならない。
 */
export const createFacilityAvailabilityCalendarQuery = (
  db: Database,
): FacilityAvailabilityCalendarQuery => ({
  findByFacilityAndPeriod: (args) =>
    ResultAsync.fromPromise(
      selectFacilities(db),
      toDatabaseError("施設・設備の一覧の取得に失敗しました。"),
    )
      .andThen((facilities) =>
        pickFacility(facilities, args.facilityId).map((facility) => ({ facilities, facility })),
      )
      .andThen(({ facilities, facility }) =>
        ResultAsync.fromPromise(
          selectReservations(db, facility.id, args.from, args.to),
          toDatabaseError("予約の取得に失敗しました。"),
        ).map((rows): FacilityAvailabilityCalendar => ({
          facilities,
          facility,
          reservations: rows,
        })),
      ),
});
