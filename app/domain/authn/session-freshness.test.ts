import { describe, expect, it } from "vitest";

import { isFreshSession, SESSION_FRESH_AGE_SECONDS } from "./session-freshness";

describe("isFreshSession", () => {
  const baseNow = new Date("2026-09-24T12:00:00.000Z");

  it("24 時間ちょうど前のセッションは false になる（境界値）", () => {
    const exactly24HoursAgo = new Date(baseNow.getTime() - SESSION_FRESH_AGE_SECONDS * 1000);
    expect(isFreshSession(exactly24HoursAgo, baseNow)).toBe(false);
  });

  it("24 時間より 1 ミリ秒新しければ true になる", () => {
    const oneMsNewerThan24h = new Date(baseNow.getTime() - SESSION_FRESH_AGE_SECONDS * 1000 + 1);
    expect(isFreshSession(oneMsNewerThan24h, baseNow)).toBe(true);
  });

  it("24 時間より 1 ミリ秒古ければ false になる", () => {
    const oneMsOlderThan24h = new Date(baseNow.getTime() - SESSION_FRESH_AGE_SECONDS * 1000 - 1);
    expect(isFreshSession(oneMsOlderThan24h, baseNow)).toBe(false);
  });

  it("現在と同じ日時のセッションは true になる", () => {
    expect(isFreshSession(baseNow, baseNow)).toBe(true);
  });
});
