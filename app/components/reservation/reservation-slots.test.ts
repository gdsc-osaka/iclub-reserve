import { describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import type { ReservationFormReservation } from "~/query/reservation/reservation-form";

import {
  findOverlapping,
  selectSlot,
  toBlockedSlots,
  toPastSlots,
  toTimelineReservations,
} from "./reservation-slots";

/** 2026 年 9 月 16 日（水） */
const day = new Date("2026-09-16T00:00:00+09:00");

const reservation = (
  overrides: Partial<ReservationFormReservation> & { id: string },
): ReservationFormReservation => ({
  facilityId: "fac_meeting_a",
  groupName: "ロボティクス開発プロジェクト",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  status: ReservationStatus.Approved,
  isOwnGroup: false,
  ...overrides,
});

describe("toTimelineReservations", () => {
  it("表示中の施設の、その日の予約だけを取り出す", () => {
    const items = toTimelineReservations(
      [
        reservation({ id: "res_here" }),
        reservation({ id: "res_other_facility", facilityId: "fac_studio" }),
        reservation({
          id: "res_other_day",
          startAt: new Date("2026-09-17T10:00:00+09:00"),
          endAt: new Date("2026-09-17T12:00:00+09:00"),
        }),
      ],
      "fac_meeting_a",
      day,
    );

    expect(items.map((item) => item.reservation.id)).toEqual(["res_here"]);
    expect(items[0]).toMatchObject({ startMinutes: 600, endMinutes: 720 });
  });

  it("利用可能時間からはみ出す予約は、時間軸に収まるよう切り詰める", () => {
    const items = toTimelineReservations(
      [
        reservation({
          id: "res_overnight",
          startAt: new Date("2026-09-15T20:00:00+09:00"),
          endAt: new Date("2026-09-16T23:00:00+09:00"),
        }),
      ],
      "fac_meeting_a",
      day,
    );

    // 9:00〜21:00 に切り詰める。帯の位置だけの話で、表示する時刻は元の値を使う
    expect(items[0]).toMatchObject({ startMinutes: 540, endMinutes: 1260 });
  });
});

describe("toBlockedSlots", () => {
  it("承認済みの予約と重なる枠を塞ぐ", () => {
    const items = toTimelineReservations(
      [reservation({ id: "res_approved" })],
      "fac_meeting_a",
      day,
    );
    const blocked = toBlockedSlots(items);

    // 10:00〜12:00 は 600・630・660・690 の 4 枠
    expect([...blocked].sort((a, b) => a - b)).toEqual([600, 630, 660, 690]);
    // 12:00 に終わる予約は 12:00 の枠を塞がない
    expect(blocked.has(720)).toBe(false);
  });

  it("仮予約は枠を塞がない", () => {
    // COND-001 が禁じているのは承認済みとの重複だけ。仮予約どうしは重なってよい
    const items = toTimelineReservations(
      [reservation({ id: "res_provisional", status: ReservationStatus.Provisional })],
      "fac_meeting_a",
      day,
    );

    expect(toBlockedSlots(items).size).toBe(0);
  });
});

describe("toPastSlots", () => {
  it("その日のうち、すでに過ぎた枠を返す", () => {
    const past = toPastSlots(day, new Date("2026-09-16T10:15:00+09:00"));

    expect(past.has(570)).toBe(true); // 9:30 は過ぎている
    expect(past.has(600)).toBe(true); // 10:00 も過ぎている
    expect(past.has(630)).toBe(false); // 10:30 はこれから
  });

  it("過ぎた日はすべての枠が過去になる", () => {
    const past = toPastSlots(day, new Date("2026-09-17T09:00:00+09:00"));

    expect(past.size).toBe(24);
  });
});

describe("findOverlapping", () => {
  it("境界が接しているだけの予約は重なりに数えない", () => {
    const items = toTimelineReservations(
      [reservation({ id: "res_approved" })],
      "fac_meeting_a",
      day,
    );

    // 終了時刻は予約に含まれないので、12:00 から始めれば重ならない
    expect(findOverlapping(items, { startMinutes: 720, endMinutes: 780 })).toHaveLength(0);
    expect(findOverlapping(items, { startMinutes: 690, endMinutes: 780 })).toHaveLength(1);
  });
});

describe("selectSlot", () => {
  const noBlocked: ReadonlySet<number> = new Set();

  it("何も選んでいなければ、押した枠だけを選ぶ", () => {
    expect(selectSlot(null, 600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("開始より後ろを押すと、そこまで伸びる", () => {
    const current = { startMinutes: 600, endMinutes: 630 };

    expect(selectSlot(current, 690, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 720 });
  });

  it("開始と同じか前を押すと、そこから選び直す", () => {
    const current = { startMinutes: 600, endMinutes: 720 };

    expect(selectSlot(current, 540, noBlocked)).toEqual({ startMinutes: 540, endMinutes: 570 });
    expect(selectSlot(current, 600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("伸ばす途中に承認済みの予約があれば、押した枠から選び直す", () => {
    /*
     * 11:00（660）が埋まっているとき、11:30 まで伸ばそうとしても届かない。
     * 手前で止めると、押した枠より前に承認済みの予約がある限り
     * 何度押しても選択が動かず、反応しない画面に見えてしまう。
     */
    const blocked = new Set([660]);
    const current = { startMinutes: 600, endMinutes: 630 };

    expect(selectSlot(current, 690, blocked)).toEqual({ startMinutes: 690, endMinutes: 720 });
  });

  it("途中が空いていれば、承認済みの予約を越えなくても伸びる", () => {
    const blocked = new Set([660]);
    const current = { startMinutes: 540, endMinutes: 570 };

    expect(selectSlot(current, 600, blocked)).toEqual({ startMinutes: 540, endMinutes: 630 });
  });
});
