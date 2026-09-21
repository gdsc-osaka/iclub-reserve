import { describe, expect, it } from "vitest";
import { formatRemainingTime } from "./invitation-expiry";

describe("formatRemainingTime", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");

  it("24 時間以上の場合は「あと N 日で期限切れ」を返す", () => {
    // ちょうど 24 時間
    const exactly24h = new Date("2026-09-22T12:00:00.000Z");
    expect(formatRemainingTime(exactly24h, baseNow)).toBe("あと 1 日で期限切れ");

    // 48 時間
    const exactly48h = new Date("2026-09-23T12:00:00.000Z");
    expect(formatRemainingTime(exactly48h, baseNow)).toBe("あと 2 日で期限切れ");

    // 25 時間 (切り捨てて 1 日)
    const hours25 = new Date("2026-09-22T13:00:00.000Z");
    expect(formatRemainingTime(hours25, baseNow)).toBe("あと 1 日で期限切れ");
  });

  it("1 時間以上 24 時間未満の場合は「あと N 時間で期限切れ」を返す", () => {
    // ちょうど 1 時間
    const exactly1h = new Date("2026-09-21T13:00:00.000Z");
    expect(formatRemainingTime(exactly1h, baseNow)).toBe("あと 1 時間で期限切れ");

    // 23 時間 59 分
    const hours23m59 = new Date("2026-09-22T11:59:00.000Z");
    expect(formatRemainingTime(hours23m59, baseNow)).toBe("あと 23 時間で期限切れ");

    // 2 時間 30 分 (切り捨てて 2 時間)
    const hours2m30 = new Date("2026-09-21T14:30:00.000Z");
    expect(formatRemainingTime(hours2m30, baseNow)).toBe("あと 2 時間で期限切れ");
  });

  it("1 分以上 1 時間未満の場合は「あと N 分で期限切れ」を返す", () => {
    // ちょうど 1 分
    const exactly1m = new Date("2026-09-21T12:01:00.000Z");
    expect(formatRemainingTime(exactly1m, baseNow)).toBe("あと 1 分で期限切れ");

    // 59 分
    const minutes59 = new Date("2026-09-21T12:59:00.000Z");
    expect(formatRemainingTime(minutes59, baseNow)).toBe("あと 59 分で期限切れ");

    // 1 分 59 秒 (切り捨てて 1 分)
    const min1sec59 = new Date("2026-09-21T12:01:59.000Z");
    expect(formatRemainingTime(min1sec59, baseNow)).toBe("あと 1 分で期限切れ");
  });

  it("1 分未満（0 以下を含む）の場合は「まもなく期限切れ」を返す", () => {
    // 59 秒
    const sec59 = new Date("2026-09-21T12:00:59.000Z");
    expect(formatRemainingTime(sec59, baseNow)).toBe("まもなく期限切れ");

    // ちょうど 0 秒
    const exactlyNow = new Date("2026-09-21T12:00:00.000Z");
    expect(formatRemainingTime(exactlyNow, baseNow)).toBe("まもなく期限切れ");

    // 過去（期限超過）
    const past = new Date("2026-09-21T11:59:00.000Z");
    expect(formatRemainingTime(past, baseNow)).toBe("まもなく期限切れ");
  });
});
