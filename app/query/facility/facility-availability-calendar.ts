import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { err, ok, ResultAsync, safeTry, type Result } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { calendarVisibleStatuses, ReservationStatus } from "~/domain/reservation";
import {
  allowedTransitions,
  isStaffTransition,
  type ReservationActor,
  type ReservationTransition,
} from "~/domain/reservation/transition";
import type { Database } from "~/infra/db";
import { createD1HolidayQuery } from "~/infra/holiday/d1-holiday-query";
import { hasOverlappingReservation } from "~/infra/reservation/reservation-overlap";
import { addDays, toTokyoDateKey } from "~/lib/date";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/** カレンダーで切り替えられる施設・設備 1 件分。 */
export interface AvailabilityFacility {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * 空き状況カレンダーに描く予約 1 件分（UC-001 / SCR-001）。
 *
 * 見るのは事務局だけなので、どの団体の予約も全項目を渡す（COND-008・COND-009）。
 * 以前は団体の利用者も見ていたため、他団体の予約から使用人数と備考を落としていたが、
 * 事務局専用にしたので（ADR-013）落とす必要が無くなった。
 */
export interface AvailabilityReservation {
  readonly id: string;
  readonly groupName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly headCount: number;
  readonly note: string | null;
  /** 事務局がこの予約に対して実行できる操作（承認・却下・事務局キャンセル） */
  readonly transitions: readonly ReservationTransition[];
  /**
   * 同一施設・同一時間帯に、ほかの承認済みの予約があるかどうか（COND-001）。
   *
   * 承認ボタンを押せるかどうかの判定に使う。
   */
  readonly hasApprovedOverlap: boolean;
}

/** 空き状況カレンダー 1 画面分のデータ。 */
export interface AvailabilityCalendar {
  /** 有効な施設・設備の一覧。画面上部の切り替えに使う */
  readonly facilities: readonly AvailabilityFacility[];
  /** いま表示している施設・設備 */
  readonly facility: AvailabilityFacility;
  /** 期間内の予約。開始日時の昇順 */
  readonly reservations: readonly AvailabilityReservation[];
  /**
   * 表示期間内の日本の祝日の日付キー（"YYYY-MM-DD"）一覧。
   *
   * カレンダーの日付見出しや列の色（日曜と同じ赤系）の判定に使用する。
   */
  readonly holidayDateKeys: readonly string[];
}

export interface FindFacilityAvailabilityCalendarArgs {
  /** 事務局かどうか（COND-009）。この画面は事務局専用（ADR-013） */
  readonly isStaff: boolean;
  /**
   * 表示する施設・設備の ID。
   *
   * null のときは一覧の先頭を返す。画面を開いた直後はまだ施設を選んでいないので、
   * 「どれも選ばれていない空のカレンダー」を出さずに済むようにしている。
   */
  readonly facilityId: string | null;
  /** 取得する期間の開始（この時刻を含む） */
  readonly from: Date;
  /** 取得する期間の終了（この時刻を含まない） */
  readonly to: Date;
}

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
 *
 * 並び順は開始日時の昇順で固定する。同じ時刻に始まる予約は予約 ID の昇順で並べる。
 * 順序を決めずに返すと、再読み込みのたびに重なった帯の左右が入れ替わって見える。
 */
const selectReservations = (db: Database, facilityId: string, from: Date, to: Date) =>
  db
    .select({
      id: reservationTable.id,
      groupName: groupTable.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      status: reservationTable.status,
      headCount: reservationTable.headCount,
      note: reservationTable.note,
      hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
    })
    .from(reservationTable)
    .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
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
          message: "有効な施設・設備が 1 件も無い。",
        })
      : ok(first);
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
 * 事務局として操作する人。
 *
 * 事務局の操作（承認・却下・事務局キャンセル）は所属を見ずに判定できるので、
 * 見ている事務局がその団体に所属しているかどうかは引かない。
 */
const staffActor: ReservationActor = { isStaff: true, membership: null };

/**
 * 有効な施設・設備の一覧と、選んだ施設の期間内の承認済み・仮予約を取得する（UC-001 / SCR-001）。
 *
 * 事務局専用の画面なので、事務局でなければ問い合わせる前に Forbidden で止める（ADR-013）。
 * 他団体の予約も含めて全項目を返す。
 *
 * 施設の一覧を取ってから予約を取る、という 2 回の問い合わせに分けている。
 * `facilityId` が null のときに「どの施設を表示するか」が
 * 一覧を見るまで決まらないため、1 回にまとめられない。
 * 予約の件数に関係なく必ず 2 回で済むので、N+1 にはならない。
 * 祝日は施設に関係なく決まるので、予約と同時に読む。
 */
export const findFacilityAvailabilityCalendar = (
  db: Database,
  args: FindFacilityAvailabilityCalendarArgs,
): ResultAsync<AvailabilityCalendar, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が、空き状況カレンダーを取得しようとした。");

    const facilities = yield* ResultAsync.fromPromise(
      selectFacilities(db),
      wrapError(QueryErrorCode.DatabaseError, "施設・設備の一覧の取得に失敗しました。"),
    );
    const facility = yield* pickFacility(facilities, args.facilityId);

    const [rows, holidayDateKeys] = yield* ResultAsync.combine([
      ResultAsync.fromPromise(
        selectReservations(db, facility.id, args.from, args.to),
        wrapError(QueryErrorCode.DatabaseError, "予約の取得に失敗しました。"),
      ),
      createD1HolidayQuery(db).findHolidaysBetween(
        toTokyoDateKey(args.from),
        // args.to は終了時刻（排他、翌週日曜 0 時など）のため、期間内の末日（直前の日）を終端とする
        toTokyoDateKey(addDays(args.to, -1)),
      ),
    ]);

    return ok({
      facilities,
      facility,
      reservations: rows.map((row): AvailabilityReservation => ({
        ...row,
        transitions: allowedTransitions(row, staffActor).filter(isStaffTransition),
      })),
      holidayDateKeys,
    });
  });
