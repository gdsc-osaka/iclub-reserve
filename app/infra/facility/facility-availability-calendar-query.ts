import { and, asc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { err, ok, okAsync, ResultAsync, type Result } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { calendarVisibleStatuses, ReservationStatus } from "~/domain/reservation";
import { hasOverlappingReservation } from "~/infra/reservation/reservation-overlap";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  AvailabilityFacility,
  AvailabilityPeriods,
  FacilityAvailabilityCalendar,
  FacilityAvailabilityCalendarQuery,
} from "~/query/facility/facility-availability-calendar";
import type { Database } from "../db";

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
 * 指定した施設の、期間（どれか 1 つ）と重なる予約を取る。
 *
 * 重なりの条件が `開始 < 期間の終わり` かつ `終わり > 期間の始まり` なのは、
 * 期間をまたぐ予約も拾うため。「開始日時が期間の中にあるもの」だけを条件にすると、
 * 前の週から続いている予約が消えて、空いているように見えてしまう。
 *
 * 期間ごとの条件は OR でつなぎ、1 回の問い合わせで取る。2 つの期間と重なる予約も 1 行だけ返る。
 *
 * 団体名は結合で一緒に取る。予約の件数だけ団体を引き直すと、
 * その回数だけ D1 との往復が増える（N+1 問題）。
 */
const selectReservations = (db: Database, facilityId: string, periods: AvailabilityPeriods) =>
  db
    .select({
      id: reservationTable.id,
      groupId: reservationTable.groupId,
      groupName: groupTable.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      status: reservationTable.status,
      headCount: reservationTable.headCount,
      note: reservationTable.note,
      hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
      hasProvisionalOverlap: hasOverlappingReservation(db, ReservationStatus.Provisional),
    })
    .from(reservationTable)
    .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
    .where(
      and(
        eq(reservationTable.facilityId, facilityId),
        // 終了した予約は描かない。理由は calendarVisibleStatuses の説明を参照
        inArray(reservationTable.status, [...calendarVisibleStatuses]),
        or(
          ...periods.map(({ from, to }) =>
            and(lt(reservationTable.startAt, to), gt(reservationTable.endAt, from)),
          ),
        ),
      ),
    )
    .orderBy(asc(reservationTable.startAt), asc(reservationTable.id));

/**
 * 一覧の中から、表示する施設を 1 件選ぶ。まだ選んでいなければ null を返す。
 *
 * `facilityId` が null（＝画面を開いた直後でまだ選んでいない）のときは、利用者に選んでもらうので null にする
 * （ADR-014 決定 20）。ただし有効な施設が 1 件だけなら、選ぶものが無いのでその施設にする。
 * 1 件も無ければ、選んでもらうこともできないので NOT_FOUND にする。
 *
 * URL を直接書き換えて存在しない ID を渡された場合は、
 * 黙って選ぶ前の状態に戻さず NOT_FOUND にする。戻してしまうと、
 * 共有されたリンクが無効になった施設を指していても気づけない。
 */
const pickFacility = (
  facilities: readonly AvailabilityFacility[],
  facilityId: string | null,
): Result<AvailabilityFacility | null, QueryError> => {
  if (facilityId === null) {
    if (facilities.length === 0) {
      return err({
        code: QueryErrorCode.NotFound,
        message: "有効な施設・設備が 1 件も無い。",
      });
    }

    return ok(facilities.length === 1 ? facilities[0] : null);
  }

  const found = facilities.find((facility) => facility.id === facilityId);

  return found === undefined
    ? err({
        code: QueryErrorCode.NotFound,
        message: `施設・設備 ${facilityId} が有効な施設の中に見つからない。`,
      })
    : ok(found);
};

/**
 * Cloudflare D1 (Drizzle) を使った FacilityAvailabilityCalendarQuery の実装。
 *
 * 施設の一覧を取ってから予約を取る、という 2 回の問い合わせに分けている。
 * `facilityId` が null のときに「どの施設を表示するか（まだ選んでいないか）」が
 * 一覧を見るまで決まらないため、1 回にまとめられない。
 * 予約の件数に関係なく多くても 2 回で済むので、N+1 にはならない。
 * 施設を選んでいなければ、予約は読まない。
 */
export const createFacilityAvailabilityCalendarQuery = (
  db: Database,
): FacilityAvailabilityCalendarQuery => ({
  findByFacilityAndPeriods: (args) =>
    ResultAsync.fromPromise(
      selectFacilities(db),
      wrapError(QueryErrorCode.DatabaseError, "施設・設備の一覧の取得に失敗しました。"),
    )
      .andThen((facilities) =>
        pickFacility(facilities, args.facilityId).map((facility) => ({ facilities, facility })),
      )
      .andThen(({ facilities, facility }) => {
        if (facility === null) {
          return okAsync<FacilityAvailabilityCalendar>({ facilities, facility, reservations: [] });
        }

        return ResultAsync.fromPromise(
          selectReservations(db, facility.id, args.periods),
          wrapError(QueryErrorCode.DatabaseError, "予約の取得に失敗しました。"),
        ).map((rows): FacilityAvailabilityCalendar => ({
          facilities,
          facility,
          reservations: rows,
        }));
      }),
});
