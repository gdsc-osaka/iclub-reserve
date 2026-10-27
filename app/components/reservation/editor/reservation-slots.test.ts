import { describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";

import {
  boundaryAtRatio,
  dragRange,
  findOverlapping,
  formatDuration,
  formatSlotRange,
  isRangeAvailable,
  resizeRange,
  slotAtRatio,
  toBlockedSlots,
  toConflicts,
  toDefaultRange,
  toPastSlots,
} from "./reservation-slots";

/** 2026 年 9 月 16 日（水） */
const day = new Date("2026-09-16T00:00:00+09:00");

const slotItem = (
  status: ReservationStatus,
  startMinutes: number,
  endMinutes: number,
  id = "",
) => ({
  reservation: { status, id },
  startMinutes,
  endMinutes,
});

describe("toBlockedSlots", () => {
  it("承認済みの予約と重なる枠を塞ぐ", () => {
    const items = [slotItem(ReservationStatus.Approved, 600, 720)];
    const blocked = toBlockedSlots(items);

    // 10:00〜12:00 は 600・630・660・690 の 4 枠
    expect([...blocked].sort((a, b) => a - b)).toEqual([600, 630, 660, 690]);
    // 12:00 に終わる予約は 12:00 の枠を塞がない
    expect(blocked.has(720)).toBe(false);
  });

  it("仮予約は枠を塞がない", () => {
    // COND-001 が禁じているのは承認済みとの重複だけ。仮予約どうしは重なってよい
    const items = [slotItem(ReservationStatus.Provisional, 600, 720)];

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
    const items = [slotItem(ReservationStatus.Approved, 600, 720)];

    // 終了時刻は予約に含まれないので、12:00 から始めれば重ならない
    expect(findOverlapping(items, { startMinutes: 720, endMinutes: 780 })).toHaveLength(0);
    expect(findOverlapping(items, { startMinutes: 690, endMinutes: 780 })).toHaveLength(1);
  });

  it("startMinutes と endMinutes を持つ任意のオブジェクト（AvailabilityBlock など）を受け取れる", () => {
    const customBlocks = [
      { id: "block_1", startMinutes: 600, endMinutes: 660, customProp: true },
      { id: "block_2", startMinutes: 720, endMinutes: 780, customProp: false },
    ];
    const result = findOverlapping(customBlocks, { startMinutes: 630, endMinutes: 750 });
    expect(result).toEqual(customBlocks);
  });
});

describe("dragRange", () => {
  const noBlocked: ReadonlySet<number> = new Set();

  it("押した枠から動かさなければ、その枠だけを選ぶ", () => {
    expect(dragRange(600, 600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("下へなぞると、なぞった先まで伸びる", () => {
    expect(dragRange(600, 690, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 720 });
  });

  it("上へなぞると、なぞった先まで伸びる", () => {
    expect(dragRange(690, 600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 720 });
  });

  it("選べない枠（承認済み・過ぎた枠）に当たったら、その手前で止まる", () => {
    expect(dragRange(600, 690, new Set([660]))).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it("上へなぞる途中で選べない枠に当たったら、その手前で止まる", () => {
    expect(dragRange(690, 600, new Set([630]))).toEqual({ startMinutes: 660, endMinutes: 720 });
  });
});

describe("formatDuration", () => {
  it("何時間・何分を整形する", () => {
    expect(formatDuration(30)).toBe("30 分");
    expect(formatDuration(60)).toBe("1 時間");
    expect(formatDuration(90)).toBe("1 時間 30 分");
    expect(formatDuration(120)).toBe("2 時間");
  });
});

describe("formatSlotRange", () => {
  it("時間帯と長さを整形する", () => {
    expect(formatSlotRange({ startMinutes: 600, endMinutes: 720 })).toBe("10:00〜12:00（2 時間）");
  });
});

describe("isRangeAvailable", () => {
  const empty: ReadonlySet<number> = new Set();

  it("塞がれておらず、過去でもなければ true", () => {
    expect(isRangeAvailable({ startMinutes: 600, endMinutes: 720 }, empty, empty)).toBe(true);
  });

  it("開始が過去の枠なら false", () => {
    expect(isRangeAvailable({ startMinutes: 600, endMinutes: 720 }, empty, new Set([600]))).toBe(
      false,
    );
  });

  it("途中の枠が過去でも、開始が未来なら通過する（過去の枠は必ず開始より前にある想定）", () => {
    expect(isRangeAvailable({ startMinutes: 600, endMinutes: 720 }, empty, new Set([540]))).toBe(
      true,
    );
  });

  it("途中の枠が承認済みの予約で塞がれていれば false", () => {
    expect(isRangeAvailable({ startMinutes: 600, endMinutes: 720 }, new Set([660]), empty)).toBe(
      false,
    );
  });
});

describe("slotAtRatio", () => {
  it("0〜1 の割合から、最も近い枠の開始分を返す", () => {
    expect(slotAtRatio(0)).toBe(540); // 9:00
    expect(slotAtRatio(0.5)).toBe(900); // 15:00
  });

  it("範囲外は端に丸める", () => {
    expect(slotAtRatio(-0.1)).toBe(540);
    expect(slotAtRatio(1.5)).toBe(1230); // 20:30
  });
});

describe("boundaryAtRatio", () => {
  it("0〜1 の割合から、最も近い 30 分の区切りを返す", () => {
    expect(boundaryAtRatio(0)).toBe(540); // 9:00
    expect(boundaryAtRatio(0.5)).toBe(900); // 15:00
    expect(boundaryAtRatio(1)).toBe(1260); // 21:00
  });

  it("範囲外は 9:00 または 21:00 に丸める", () => {
    expect(boundaryAtRatio(-0.1)).toBe(540);
    expect(boundaryAtRatio(1.5)).toBe(1260);
  });
});

describe("resizeRange", () => {
  const baseRange = { startMinutes: 600, endMinutes: 720 };
  const unselectable = new Set([780]);

  it("終了時刻を下に伸ばす", () => {
    const resized = resizeRange(baseRange, "end", 780, unselectable);
    expect(resized).toEqual({ startMinutes: 600, endMinutes: 780 });
  });

  it("終了時刻を縮める（30 分より短くはならない）", () => {
    const resized = resizeRange(baseRange, "end", 630, unselectable);
    expect(resized).toEqual({ startMinutes: 600, endMinutes: 630 });

    const tooShort = resizeRange(baseRange, "end", 570, unselectable);
    expect(tooShort).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("開始時刻を上に伸ばす", () => {
    const resized = resizeRange(baseRange, "start", 540, unselectable);
    expect(resized).toEqual({ startMinutes: 540, endMinutes: 720 });
  });

  it("開始時刻を縮める（30 分より短くはならない）", () => {
    const resized = resizeRange(baseRange, "start", 660, unselectable);
    expect(resized).toEqual({ startMinutes: 660, endMinutes: 720 });

    const tooShort = resizeRange(baseRange, "start", 750, unselectable);
    expect(tooShort).toEqual({ startMinutes: 690, endMinutes: 720 });
  });
});

describe("toDefaultRange", () => {
  const noBlocked: ReadonlySet<number> = new Set();

  it("通常は 1 時間（2 枠）の長さを返す", () => {
    expect(toDefaultRange(600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it("30 分後の枠が埋まっている場合は 30 分（1 枠）の長さを返す", () => {
    const blocked = new Set([630]);
    expect(toDefaultRange(600, blocked)).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("閉館時刻（21:00）をまたぐ場合は 30 分の長さを返す", () => {
    expect(toDefaultRange(1230, noBlocked)).toEqual({ startMinutes: 1230, endMinutes: 1260 });
  });
});

describe("toConflicts", () => {
  it("時間帯と重なる予約を承認済みと仮予約に分ける", () => {
    const items = [
      slotItem(ReservationStatus.Approved, 600, 720, "res_app"),
      slotItem(ReservationStatus.Provisional, 660, 780, "res_prov"),
      slotItem(ReservationStatus.Approved, 780, 840, "res_far"),
    ];

    const result = toConflicts(items, { startMinutes: 630, endMinutes: 750 });
    expect(result.approvedConflicts.map((i) => i.reservation.id)).toEqual(["res_app"]);
    expect(result.provisionalConflicts.map((i) => i.reservation.id)).toEqual(["res_prov"]);
  });
});
