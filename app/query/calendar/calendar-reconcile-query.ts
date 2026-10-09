import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/**
 * 突き合わせ対象の施設情報。
 *
 * 有効・無効は問わず、Google Calendar ID が設定されている施設が対象（COND-024 (4)）。
 */
export interface CalendarReconcileFacility {
  readonly id: string;
  readonly name: string;
  readonly googleCalendarId: string;
}

/**
 * 突き合わせ対象の承認済み予約情報。
 */
export interface CalendarReconcileReservation {
  readonly id: string;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * 日次の突き合わせに必要な施設と予約の状態を読み取るクエリポート。
 */
export interface CalendarReconcileQuery {
  /**
   * Google Calendar ID が設定されているすべての施設を取得する。
   * 有効・無効は問わない。
   */
  fetchTargetFacilities(): ResultAsync<readonly CalendarReconcileFacility[], QueryError>;

  /**
   * 指定された施設のうち、承認済みで終了日時が rangeStart 以降の予約をすべて取得する。
   * 施設ごとに問い合わせず、1 回の問い合わせで全件取得する。
   */
  fetchApprovedReservations(
    facilityIds: readonly string[],
    rangeStart: Date,
  ): ResultAsync<readonly CalendarReconcileReservation[], QueryError>;
}
