import type { ResultAsync } from "neverthrow";
import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

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
export interface TodayScheduleReservation {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly headCount: number;
}

/**
 * 事務局向け「今日の予約状況」問い合わせ結果。
 */
export interface StaffTodayScheduleResult {
  readonly facilities: readonly TodayScheduleFacility[];
  readonly reservations: readonly TodayScheduleReservation[];
}

export interface StaffTodayScheduleQuery {
  /**
   * 有効な施設・設備すべてと、`now` の日（日本時間）にかかる承認済み・仮予約を取得する。
   */
  findTodaySchedule(now: Date): ResultAsync<StaffTodayScheduleResult, QueryError>;
}
