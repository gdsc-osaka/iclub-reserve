import { describe, expect, it } from "vite-plus/test";

import { toOverlapPeriodLabel, toOverlapTimeline } from "./overlap-timeline";

describe("toOverlapTimeline", () => {
  it("空の配列なら空の目盛りと帯を返す", () => {
    const result = toOverlapTimeline([]);
    expect(result.ticks).toEqual([]);
    expect(result.bars.size).toBe(0);
  });

  it("軸の切り捨て・切り上げが行われ、正時の範囲で軸が作られる", () => {
    // 10:15 開始、12:45 終了 → 軸は 10:00 (600分) 〜 13:00 (780分)、スパン 180 分 (3 時間)
    const items = [
      {
        id: "res-1",
        startAt: new Date("2026-11-12T01:15:00.000Z"), // JST 10:15
        endAt: new Date("2026-11-12T03:45:00.000Z"), // JST 12:45
      },
    ];

    const result = toOverlapTimeline(items);

    // 3 時間なので 1 時間おきの目盛り (10:00, 11:00, 12:00, 13:00)
    expect(result.ticks).toHaveLength(4);
    expect(result.ticks[0]?.label).toBe("10:00");
    expect(result.ticks[0]?.percent).toBe(0);
    expect(result.ticks[1]?.label).toBe("11:00");
    expect(result.ticks[1]?.percent).toBeCloseTo(33.333, 2);
    expect(result.ticks[2]?.label).toBe("12:00");
    expect(result.ticks[2]?.percent).toBeCloseTo(66.666, 2);
    expect(result.ticks[3]?.label).toBe("13:00");
    expect(result.ticks[3]?.percent).toBe(100);
  });

  it("帯の位置（leftPercent）と幅（widthPercent）が正しく計算される", () => {
    // 軸: 10:00 (600分) 〜 13:00 (780分)、総分 180 分
    // res-1: 10:30 (630分) 〜 11:30 (690分) → left: (630 - 600) / 180 = 16.667%、width: 60 / 180 = 33.333%
    // res-2: 11:00 (660分) 〜 12:30 (750分) → left: (660 - 600) / 180 = 33.333%、width: 90 / 180 = 50.0%
    const items = [
      {
        id: "res-1",
        startAt: new Date("2026-11-12T01:30:00.000Z"), // JST 10:30
        endAt: new Date("2026-11-12T02:30:00.000Z"), // JST 11:30
      },
      {
        id: "res-2",
        startAt: new Date("2026-11-12T02:00:00.000Z"), // JST 11:00
        endAt: new Date("2026-11-12T03:30:00.000Z"), // JST 12:30
      },
    ];

    const result = toOverlapTimeline(items);

    const bar1 = result.bars.get("res-1");
    expect(bar1).toBeDefined();
    expect(bar1?.leftPercent).toBeCloseTo(16.667, 2);
    expect(bar1?.widthPercent).toBeCloseTo(33.333, 2);

    const bar2 = result.bars.get("res-2");
    expect(bar2).toBeDefined();
    expect(bar2?.leftPercent).toBeCloseTo(33.333, 2);
    expect(bar2?.widthPercent).toBeCloseTo(50, 2);
  });

  it("ちょうど正時に始まり正時に終わるとき、軸の端と予約の端が一致する", () => {
    // 10:00 開始、12:00 終了 → 軸は 10:00 〜 12:00 (120 分)
    const items = [
      {
        id: "res-1",
        startAt: new Date("2026-11-12T01:00:00.000Z"), // JST 10:00
        endAt: new Date("2026-11-12T03:00:00.000Z"), // JST 12:00
      },
    ];

    const result = toOverlapTimeline(items);

    expect(result.ticks[0]?.label).toBe("10:00");
    expect(result.ticks[0]?.percent).toBe(0);
    expect(result.ticks[result.ticks.length - 1]?.label).toBe("12:00");
    expect(result.ticks[result.ticks.length - 1]?.percent).toBe(100);

    const bar = result.bars.get("res-1");
    expect(bar?.leftPercent).toBe(0);
    expect(bar?.widthPercent).toBe(100);
  });

  it("軸が 6 時間を超えるときは 2 時間おきに目盛りが振られる", () => {
    // 10:00 開始、18:00 終了 → 8 時間 (480 分) > 6 時間
    // 目盛りは 10:00, 12:00, 14:00, 16:00, 18:00 (5 本)
    const items = [
      {
        id: "res-1",
        startAt: new Date("2026-11-12T01:00:00.000Z"), // JST 10:00
        endAt: new Date("2026-11-12T09:00:00.000Z"), // JST 18:00
      },
    ];

    const result = toOverlapTimeline(items);

    expect(result.ticks.map((t) => t.label)).toEqual(["10:00", "12:00", "14:00", "16:00", "18:00"]);
    expect(result.ticks[0]?.percent).toBe(0);
    expect(result.ticks[1]?.percent).toBe(25);
    expect(result.ticks[2]?.percent).toBe(50);
    expect(result.ticks[3]?.percent).toBe(75);
    expect(result.ticks[4]?.percent).toBe(100);
  });
});

describe("toOverlapPeriodLabel", () => {
  it("予約が無ければ null を返す", () => {
    expect(toOverlapPeriodLabel([])).toBeNull();
  });

  it("最も早い開始から最も遅い終了までを、日本時間の月日と曜日を付けて返す", () => {
    // 申請の順（11〜13 時が先頭）に並んでいても、時刻の早い・遅いで決める
    const items = [
      {
        startAt: new Date("2026-11-12T02:00:00.000Z"), // JST 11:00
        endAt: new Date("2026-11-12T04:00:00.000Z"), // JST 13:00
      },
      {
        startAt: new Date("2026-11-12T01:00:00.000Z"), // JST 10:00
        endAt: new Date("2026-11-12T03:00:00.000Z"), // JST 12:00
      },
      {
        startAt: new Date("2026-11-12T03:00:00.000Z"), // JST 12:00
        endAt: new Date("2026-11-12T05:00:00.000Z"), // JST 14:00
      },
    ];

    expect(toOverlapPeriodLabel(items)).toBe("11/12(木) 10:00 – 14:00");
  });
});
