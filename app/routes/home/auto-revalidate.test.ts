import { describe, expect, it } from "vite-plus/test";

import { shouldAutoRevalidate, type AutoRevalidateConditions } from "./auto-revalidate";

describe("shouldAutoRevalidate", () => {
  const baseConditions: AutoRevalidateConditions = {
    isVisible: true,
    isOnline: true,
    isBusy: false,
    isDialogOpen: false,
    elapsedMs: 60_000,
    thresholdMs: 30_000,
  };

  it("すべての条件を満たすときは true を返す", () => {
    expect(shouldAutoRevalidate(baseConditions)).toBe(true);
  });

  it("elapsedMs が thresholdMs と等しい境界値でも true を返す", () => {
    expect(
      shouldAutoRevalidate({
        ...baseConditions,
        elapsedMs: 30_000,
        thresholdMs: 30_000,
      }),
    ).toBe(true);
  });

  it.each([
    ["タブが非表示（isVisible が false）", { isVisible: false }],
    ["オフライン（isOnline が false）", { isOnline: false }],
    ["ビジー中（isBusy が true）", { isBusy: true }],
    ["ダイアログ表示中（isDialogOpen が true）", { isDialogOpen: true }],
    [
      "経過時間がしきい値未満（elapsedMs < thresholdMs）",
      { elapsedMs: 29_999, thresholdMs: 30_000 },
    ],
  ])("条件を 1 つ外すと false を返す: %s", (_, override) => {
    expect(shouldAutoRevalidate({ ...baseConditions, ...override })).toBe(false);
  });
});
