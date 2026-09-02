import { describe, expect, it } from "vitest";
import { parsePasskeyPromptState, recordDismissal, shouldSuggestPasskey } from "./passkey-prompt";

/** テストの基準にする日時（2026-09-01 09:00 JST）。 */
const NOW = new Date("2026-09-01T00:00:00.000Z").getTime();

/** NOW から指定した日数だけさかのぼった日時を返す。 */
const daysAgo = (days: number): number => NOW - days * 24 * 60 * 60 * 1000;

describe("shouldSuggestPasskey", () => {
  it("一度も断られていなければ勧める", () => {
    expect(shouldSuggestPasskey(null, NOW)).toBe(true);
  });

  it.each([
    ["1 回断られてから 14 日後", 1, 14],
    ["1 回断られてから 30 日後", 1, 30],
    ["2 回断られてから 60 日後", 2, 60],
  ])("%s なら勧める", (_, dismissedCount, elapsedDays) => {
    const state = { dismissedCount, dismissedAt: daysAgo(elapsedDays) };

    expect(shouldSuggestPasskey(state, NOW)).toBe(true);
  });

  it.each([
    ["1 回断られた直後", 1, 0],
    ["1 回断られてから 13 日後", 1, 13],
    ["2 回断られてから 59 日後", 2, 59],
  ])("%s なら勧めない", (_, dismissedCount, elapsedDays) => {
    const state = { dismissedCount, dismissedAt: daysAgo(elapsedDays) };

    expect(shouldSuggestPasskey(state, NOW)).toBe(false);
  });

  it("3 回断られたら、どれだけ時間が経っても勧めない", () => {
    const state = { dismissedCount: 3, dismissedAt: daysAgo(3650) };

    expect(shouldSuggestPasskey(state, NOW)).toBe(false);
  });

  it("端末の時計が狂って未来の日時が記録されていたら勧める", () => {
    const state = { dismissedCount: 1, dismissedAt: daysAgo(-365) };

    expect(shouldSuggestPasskey(state, NOW)).toBe(true);
  });
});

describe("recordDismissal", () => {
  it("初めて断られたら 1 回目として記録する", () => {
    expect(recordDismissal(null, NOW)).toEqual({ dismissedCount: 1, dismissedAt: NOW });
  });

  it("すでに記録があれば回数を 1 つ増やし、日時を今にする", () => {
    const state = { dismissedCount: 1, dismissedAt: daysAgo(20) };

    expect(recordDismissal(state, NOW)).toEqual({ dismissedCount: 2, dismissedAt: NOW });
  });
});

describe("parsePasskeyPromptState", () => {
  it("保存した記録をそのまま読み戻せる", () => {
    const state = { dismissedCount: 2, dismissedAt: NOW };

    expect(parsePasskeyPromptState(JSON.stringify(state))).toEqual(state);
  });

  it.each([
    ["保存されていない", null],
    ["JSON として読めない", "{"],
    ["オブジェクトではない", '"あとで"'],
    ["null", "null"],
    ["回数がない", '{"dismissedAt":1}'],
    ["回数が数値ではない", '{"dismissedCount":"1","dismissedAt":1}'],
    ["回数が整数ではない", '{"dismissedCount":1.5,"dismissedAt":1}'],
    ["回数が 0", '{"dismissedCount":0,"dismissedAt":1}'],
    ["日時がない", '{"dismissedCount":1}'],
    ["日時が数値ではない", '{"dismissedCount":1,"dismissedAt":"2026-09-01"}'],
  ])("%s なら記録なしとして扱う", (_, raw) => {
    expect(parsePasskeyPromptState(raw)).toBeNull();
  });
});
