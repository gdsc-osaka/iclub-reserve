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

/** 時間の軸に並べた、10:00〜12:00 の予約の帯 1 件分（既定は承認済み） */
const slotItem = (status: ReservationStatus = ReservationStatus.Approved) => ({
  reservation: { status },
  startMinutes: 600,
  endMinutes: 720,
});

describe("toBlockedSlots", () => {
  it("承認済みの予約と重なる枠を塞ぐ", () => {
    const items = [slotItem()];
    const blocked = toBlockedSlots(items);

    // 10:00〜12:00 は 600・630・660・690 の 4 枠
    expect([...blocked].sort((a, b) => a - b)).toEqual([600, 630, 660, 690]);
    // 12:00 に終わる予約は 12:00 の枠を塞がない
    expect(blocked.has(720)).toBe(false);
  });

  it("仮予約は枠を塞がない", () => {
    // COND-001 が禁じているのは承認済みとの重複だけ。仮予約どうしは重なってよい
    const items = [slotItem(ReservationStatus.Provisional)];

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
    const items = [slotItem()];

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

  it("上へなぞっても、同じ範囲を選べる", () => {
    // 押し始めた枠が後ろでも、選ばれるのは「なぞった先〜押し始めた枠の終わり」
    expect(dragRange(690, 600, noBlocked)).toEqual({ startMinutes: 600, endMinutes: 720 });
  });

  it("なぞった先に承認済みの予約があれば、その手前で止まる", () => {
    /*
     * 11:00（660）が埋まっているとき、11:30（690）まで指を運んでも 11:00 は越えない。
     * なぞる操作では帯が指に追従しているので、
     * 止まった位置がそのまま「ここまでしか取れない」と読める。
     */
    expect(dragRange(600, 690, new Set([660]))).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it("上へなぞるときも、承認済みの予約の手前で止まる", () => {
    expect(dragRange(690, 600, new Set([630]))).toEqual({ startMinutes: 660, endMinutes: 720 });
  });
});

describe("formatDuration", () => {
  it("1 時間に満たなければ分だけで書く", () => {
    expect(formatDuration(30)).toBe("30 分");
  });

  it("ちょうどの時間なら時間だけで書く", () => {
    expect(formatDuration(120)).toBe("2 時間");
  });

  it("端数があれば時間と分を並べて書く", () => {
    expect(formatDuration(90)).toBe("1 時間 30 分");
  });
});

describe("formatSlotRange", () => {
  it("開始〜終了に長さを添えて書く", () => {
    expect(formatSlotRange({ startMinutes: 780, endMinutes: 900 })).toBe("13:00〜15:00（2 時間）");
  });
});

describe("toDefaultRange", () => {
  it("何も無ければ 1 時間にする", () => {
    expect(toDefaultRange(600, new Set())).toEqual({ startMinutes: 600, endMinutes: 660 });
  });

  it("30 分後の枠が承認済みと重なるなら 30 分にする", () => {
    expect(toDefaultRange(600, new Set([630]))).toEqual({ startMinutes: 600, endMinutes: 630 });
  });

  it("20:30 開始は 21:00 を超えるので 30 分にする", () => {
    expect(toDefaultRange(1230, new Set())).toEqual({ startMinutes: 1230, endMinutes: 1260 });
  });

  it("20:00 開始は 21:00 までの 1 時間を取れる", () => {
    expect(toDefaultRange(1200, new Set())).toEqual({ startMinutes: 1200, endMinutes: 1260 });
  });
});

describe("isRangeAvailable", () => {
  it("空いており開始時刻を過ぎていなければ true を返す", () => {
    const range = { startMinutes: 600, endMinutes: 660 }; // 10:00〜11:00
    expect(isRangeAvailable(range, new Set(), new Set())).toBe(true);
  });

  it("開始枠が過ぎている（pastSlots に含まれる）場合は false を返す", () => {
    const range = { startMinutes: 600, endMinutes: 660 };
    expect(isRangeAvailable(range, new Set(), new Set([600]))).toBe(false);
  });

  it("時間帯のいずれかの枠が承認済みと重なる（blockedSlots に含まれる）場合は false を返す", () => {
    const range = { startMinutes: 600, endMinutes: 660 }; // 600, 630
    // 10:30 (630) が重なっている
    expect(isRangeAvailable(range, new Set([630]), new Set())).toBe(false);
    // 10:00 (600) が重なっている
    expect(isRangeAvailable(range, new Set([600]), new Set())).toBe(false);
  });

  it("時間帯の外の枠だけが塞がれていても true を返す", () => {
    const range = { startMinutes: 600, endMinutes: 660 };
    // 11:00 (660) や 9:30 (570) が塞がれていても影響しない
    expect(isRangeAvailable(range, new Set([570, 660]), new Set([570]))).toBe(true);
  });
});

describe("toConflicts", () => {
  it("指定した時間帯と重なる予約を承認済みと仮予約に分けて返す", () => {
    const approvedItem = {
      reservation: { status: ReservationStatus.Approved, id: "res_app" },
      startMinutes: 600,
      endMinutes: 660,
    };
    const provisionalItem = {
      reservation: { status: ReservationStatus.Provisional, id: "res_prov" },
      startMinutes: 630,
      endMinutes: 720,
    };
    const outsideItem = {
      reservation: { status: ReservationStatus.Approved, id: "res_out" },
      startMinutes: 720,
      endMinutes: 780,
    };

    const conflicts = toConflicts([approvedItem, provisionalItem, outsideItem], {
      startMinutes: 600,
      endMinutes: 660,
    });

    expect(conflicts.approvedConflicts).toEqual([approvedItem]);
    expect(conflicts.provisionalConflicts).toEqual([provisionalItem]);
  });
});

describe("slotAtRatio", () => {
  it("時間の軸の上からの位置（0〜1）にある 30 分の枠の開始（分）を返す", () => {
    // 0 は先頭の枠（9:00 = 540）
    expect(slotAtRatio(0)).toBe(540);
    // 1 枠目（9:30 = 570）
    expect(slotAtRatio(1 / 24)).toBe(570);
    // 0.5 付近（12 枠目 = 15:00 = 900）
    expect(slotAtRatio(0.5)).toBe(900);
  });

  it("範囲の外は端の枠（9:00 または 20:30）に丸める", () => {
    expect(slotAtRatio(-0.2)).toBe(540);
    expect(slotAtRatio(1.5)).toBe(1230); // 最後の枠は 20:30 = 1230
  });
});

describe("boundaryAtRatio", () => {
  it("その位置にいちばん近い 30 分の区切り（9:00〜21:00）を返す", () => {
    // 0 は 9:00 = 540
    expect(boundaryAtRatio(0)).toBe(540);
    // 1 は 21:00 = 1260
    expect(boundaryAtRatio(1)).toBe(1260);
    // 0.5 は 15:00 = 900
    expect(boundaryAtRatio(0.5)).toBe(900);
  });

  it("範囲の外は 9:00・21:00 に丸める", () => {
    expect(boundaryAtRatio(-0.5)).toBe(540);
    expect(boundaryAtRatio(1.5)).toBe(1260);
  });
});

describe("resizeRange", () => {
  const baseRange = { startMinutes: 600, endMinutes: 660 }; // 10:00〜11:00

  it("10:00〜11:00 の終了を 12:00 へ → 10:00〜12:00", () => {
    expect(resizeRange(baseRange, "end", 720, new Set())).toEqual({
      startMinutes: 600,
      endMinutes: 720,
    });
  });

  it("終了を 10:00 へ → 10:00〜10:30（30 分より短くしない）", () => {
    expect(resizeRange(baseRange, "end", 600, new Set())).toEqual({
      startMinutes: 600,
      endMinutes: 630,
    });
  });

  it("11:30 の枠が選べないときに終了を 13:00 へ → 10:00〜11:30", () => {
    // 11:30 の枠 = 690 分（11:30〜12:00）
    expect(resizeRange(baseRange, "end", 780, new Set([690]))).toEqual({
      startMinutes: 600,
      endMinutes: 690,
    });
  });

  it("終了を 21:00 より後へ → 21:00 まで", () => {
    expect(resizeRange(baseRange, "end", 1300, new Set())).toEqual({
      startMinutes: 600,
      endMinutes: 1260,
    });
  });

  it("9:00・9:30 の枠が過ぎているときに開始を 9:00 へ → 10:00 のまま", () => {
    // 9:00 (540), 9:30 (570) が選べない。9:30 の枠が塞がれているので 10:00 より上へ伸ばせない
    expect(resizeRange(baseRange, "start", 540, new Set([540, 570]))).toEqual({
      startMinutes: 600,
      endMinutes: 660,
    });
  });

  it("開始を 11:00 へ → 10:30〜11:00", () => {
    expect(resizeRange(baseRange, "start", 660, new Set())).toEqual({
      startMinutes: 630,
      endMinutes: 660,
    });
  });
});
