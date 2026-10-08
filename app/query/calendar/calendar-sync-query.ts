import type { ResultAsync } from "neverthrow";
import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/**
 * カレンダー同期で参照する予約と施設の最新状態。
 */
export interface CalendarSyncReservationState {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly facility: {
    readonly name: string;
    readonly googleCalendarId: string | null;
  } | null;
}

/**
 * 施設のカレンダー ID 情報。
 */
export interface FacilityCalendarId {
  readonly id: string;
  readonly googleCalendarId: string | null;
}

/**
 * カレンダー同期に必要な予約・施設の状態を取得する読み取り専用窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、この結果を使って更新してはいけない。
 */
export interface CalendarSyncQuery {
  /**
   * 予約 ID の配列から、各予約の最新状態と施設のカレンダー情報を 1 回の問い合わせで取得する。
   * DB に存在しない予約 ID は結果に含まれない。
   */
  fetchReservationStates(
    reservationIds: readonly string[],
  ): ResultAsync<readonly CalendarSyncReservationState[], QueryError>;

  /**
   * 施設 ID の配列から、各施設の googleCalendarId を 1 回の問い合わせで取得する。
   * 変更前の施設のカレンダーを引くために使用する。
   */
  fetchFacilityCalendarIds(
    facilityIds: readonly string[],
  ): ResultAsync<readonly FacilityCalendarId[], QueryError>;
}
