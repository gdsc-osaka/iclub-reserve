import { describe, expect, it } from "vitest";

import { formatDateTime, formatReservationPeriod, isSameDayInJapan } from "./date";

describe("formatDateTime", () => {
  it("日本時間の日時に変換する", () => {
    expect(formatDateTime(new Date("2026-06-28T17:54:30+09:00"))).toBe("2026年6月28日 17:54");
  });
});

describe("isSameDayInJapan", () => {
  it("日本時間で同じ日なら true", () => {
    expect(
      isSameDayInJapan(
        new Date("2026-06-28T00:00:00+09:00"),
        new Date("2026-06-28T23:59:00+09:00"),
      ),
    ).toBe(true);
  });

  it("UTC では同じ日でも、日本時間で日をまたいでいれば false", () => {
    // どちらも UTC では 2026-06-28。日本時間では 28 日 23:00 と 29 日 00:00 になる
    expect(
      isSameDayInJapan(new Date("2026-06-28T14:00:00Z"), new Date("2026-06-28T15:00:00Z")),
    ).toBe(false);
  });
});

describe("formatReservationPeriod", () => {
  it("同じ日に収まる予約は日付を 1 度だけ書く", () => {
    expect(
      formatReservationPeriod(
        new Date("2026-06-28T17:54:00+09:00"),
        new Date("2026-06-28T19:00:00+09:00"),
      ),
    ).toBe("2026年6月28日(日) 17:54〜19:00");
  });

  it("日をまたぐ予約は両方の日付を書く", () => {
    expect(
      formatReservationPeriod(
        new Date("2026-06-28T22:00:00+09:00"),
        new Date("2026-06-29T09:00:00+09:00"),
      ),
    ).toBe("2026年6月28日(日) 22:00 〜 2026年6月29日(月) 09:00");
  });

  it("日本時間で日をまたぐかどうかで判定する", () => {
    // UTC で見ると同じ日だが、日本時間では 28 日から 29 日へまたいでいる
    expect(
      formatReservationPeriod(new Date("2026-06-28T14:00:00Z"), new Date("2026-06-28T16:00:00Z")),
    ).toBe("2026年6月28日(日) 23:00 〜 2026年6月29日(月) 01:00");
  });
});
