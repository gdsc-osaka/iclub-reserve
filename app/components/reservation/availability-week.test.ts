import { describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { toDayBlocks, toOccupiedHours, type AvailabilityDay } from "./availability-week";

const day: AvailabilityDay = {
  date: new Date("2026-09-14T00:00:00+09:00"),
  dateKey: "2026-09-14",
  isToday: false,
};

/** 時間帯とステータスだけを変えた予約を作る。他の項目はこの検証に関係しない */
const reservation = (
  startAt: string,
  endAt: string,
  status: ReservationStatus,
): AvailabilityReservation => ({
  id: `res_${startAt}`,
  groupName: "ロボティクス開発プロジェクト",
  startAt: new Date(startAt),
  endAt: new Date(endAt),
  status,
  isOwnGroup: false,
  detail: null,
});

/** その日の予約から、押せなくなる「時」を取り出す */
const occupiedHours = (reservations: readonly AvailabilityReservation[]): readonly number[] =>
  [...toOccupiedHours(toDayBlocks(day, reservations))].sort((a, b) => a - b);

describe("toOccupiedHours", () => {
  it("承認済みの予約が重なっている時間を返す", () => {
    const hours = occupiedHours([
      reservation(
        "2026-09-14T10:00:00+09:00",
        "2026-09-14T12:00:00+09:00",
        ReservationStatus.Approved,
      ),
    ]);

    // 12 時の枠は空いている。終わりの時刻ちょうどは重なっていない
    expect(hours).toEqual([10, 11]);
  });

  it("仮予約は時間を塞がない", () => {
    const hours = occupiedHours([
      reservation(
        "2026-09-14T10:00:00+09:00",
        "2026-09-14T12:00:00+09:00",
        ReservationStatus.Provisional,
      ),
    ]);

    // COND-001 が重複を禁じているのは承認済みの予約に対してだけ
    expect(hours).toEqual([]);
  });

  it("1 時間の一部にしか重なっていなくても塞ぐ", () => {
    const hours = occupiedHours([
      reservation(
        "2026-09-14T10:30:00+09:00",
        "2026-09-14T11:00:00+09:00",
        ReservationStatus.Approved,
      ),
    ]);

    expect(hours).toEqual([10]);
  });

  it("利用時間の外から続く予約は、表に出ている範囲だけを塞ぐ", () => {
    const hours = occupiedHours([
      reservation(
        "2026-09-14T07:00:00+09:00",
        "2026-09-14T10:00:00+09:00",
        ReservationStatus.Approved,
      ),
    ]);

    // 9 時より前の枠は存在しないので、塞がるのは 9 時の枠だけ
    expect(hours).toEqual([9]);
  });

  it("別の日の予約は塞がない", () => {
    const hours = occupiedHours([
      reservation(
        "2026-09-15T10:00:00+09:00",
        "2026-09-15T12:00:00+09:00",
        ReservationStatus.Approved,
      ),
    ]);

    expect(hours).toEqual([]);
  });
});
