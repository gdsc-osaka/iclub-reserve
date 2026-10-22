/**
 * 予約を 1 行で見せる読み取り（予約の一覧・ダッシュボードの区画など）が共通に使う、型と列。
 *
 * どの団体が・どの施設を・いつ使うかは、どの読み取りも同じ形で持つので、ここに 1 つだけ書く。
 * 読んだ行から項目を落として画面へ渡す型（`ReservationListItem` など）は、行の型から `Omit` で作らずに
 * 項目を 1 つずつ書く。行に項目を足したとき、画面へ渡す項目まで黙って増えないようにするため。
 */
import { facilityTable, groupTable, reservationTable } from "~/db/schema";

/** 予約を 1 行で見せる読み取りが共通に持つ項目（どの団体が・どの施設を・いつ） */
export interface ReservationWithNames {
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** `ReservationWithNames` の列。select に `...reservationWithNamesColumns` で広げる。団体と施設を JOIN しておくこと */
export const reservationWithNamesColumns = {
  groupId: reservationTable.groupId,
  groupName: groupTable.name,
  facilityId: reservationTable.facilityId,
  facilityName: facilityTable.name,
  startAt: reservationTable.startAt,
  endAt: reservationTable.endAt,
};
