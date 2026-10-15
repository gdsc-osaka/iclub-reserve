import { describe, expect, it } from "vitest";

import { isShortNotice } from "./lead-time";

describe("isShortNotice（COND-028）", () => {
  const now = new Date("2026-10-15T12:00:00+09:00");

  it("今日・明日に始まる予約は 7 日を切っている", () => {
    expect(isShortNotice(new Date("2026-10-15T18:00:00+09:00"), now)).toBe(true);
    expect(isShortNotice(new Date("2026-10-16T09:00:00+09:00"), now)).toBe(true);
  });

  it("ちょうど 7 日後に始まる予約は含めない", () => {
    expect(isShortNotice(new Date("2026-10-22T12:00:00+09:00"), now)).toBe(false);
  });

  it("7 日後の日でも、今の時刻より前に始まる予約は含める", () => {
    expect(isShortNotice(new Date("2026-10-22T11:59:00+09:00"), now)).toBe(true);
  });

  it("7 日後の日の、今の時刻より後に始まる予約は含めない", () => {
    expect(isShortNotice(new Date("2026-10-22T13:00:00+09:00"), now)).toBe(false);
  });
});
