import { describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import {
  blockContent,
  toDayBlocks,
  toOccupiedHours,
  weekdayStyle,
  type AvailabilityDay,
} from "./availability-week";

const day: AvailabilityDay = {
  date: new Date("2026-09-14T00:00:00+09:00"),
  dateKey: "2026-09-14",
  isToday: false,
  // 2026-09-14 は月曜日
  weekday: 1,
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

describe("weekdayStyle", () => {
  it("土曜は青系、日曜は赤系の色を返す", () => {
    expect(weekdayStyle(6).label).toContain("blue");
    expect(weekdayStyle(0).label).toContain("red");
  });

  it("面の色は曜日の色と同じ系統にする", () => {
    // 見出しと列に同じ色を敷くので、文字の色と系統が違うとちぐはぐに見える
    expect(weekdayStyle(6).surface).toContain("blue");
    expect(weekdayStyle(0).surface).toContain("red");
  });

  it("平日は色を付けない", () => {
    // null と空文字を取り違えると、今日の色と平日の色の区別がつかなくなる
    expect(weekdayStyle(3)).toEqual({ label: null, surface: null });
  });
});

describe("blockContent", () => {
  it("1 時間の帯には時刻と団体名 2 行が入る", () => {
    expect(blockContent(60, 1)).toEqual({
      showTime: true,
      showStatus: false,
      showHeadCount: false,
      nameLines: 2,
    });
  });

  it("横に 2 つ並ぶと団体名だけにして、行をすべて回す", () => {
    // 幅が半分になるので、時刻やステータスまで書くとどの行も数文字で切れる
    expect(blockContent(60, 2)).toEqual({
      showTime: false,
      showStatus: false,
      showHeadCount: false,
      nameLines: 3,
    });
  });

  it("横に並んだ長い帯でも、団体名の折り返しは 6 行で打ち止めにする", () => {
    expect(blockContent(300, 2).nameLines).toBe(6);
  });

  it("短い帯は団体名だけにする", () => {
    expect(blockContent(30, 1)).toEqual({
      showTime: false,
      showStatus: false,
      showHeadCount: false,
      nameLines: 1,
    });
  });

  it("長い帯にはステータスと使用人数まで入る", () => {
    const tall = blockContent(180, 1);

    expect(tall.showTime).toBe(true);
    expect(tall.showStatus).toBe(true);
    expect(tall.showHeadCount).toBe(true);
  });

  it("団体名の折り返しは 3 行で打ち止めにする", () => {
    // 行数をそのまま増やすと、長い帯で団体名だけが縦に伸びてしまう
    expect(blockContent(600, 1).nameLines).toBe(3);
  });
});
