import { describe, expect, it } from "vitest";

import { GroupStatus } from "./index";
import { canChangeGroupStatus } from "./status-transition";

describe("canChangeGroupStatus（STATE-002 / UC-014: 団体の状態遷移ルール）", () => {
  describe("許される遷移（4 パターン）", () => {
    it.each([
      {
        from: GroupStatus.Pending,
        to: GroupStatus.Enabled,
        description: "pending -> enabled（承認待ち団体の有効化）",
      },
      {
        from: GroupStatus.Pending,
        to: GroupStatus.Disabled,
        description: "pending -> disabled（承認待ち団体の却下・無効化）",
      },
      {
        from: GroupStatus.Enabled,
        to: GroupStatus.Disabled,
        description: "enabled -> disabled（有効な団体の無効化）",
      },
      {
        from: GroupStatus.Disabled,
        to: GroupStatus.Enabled,
        description: "disabled -> enabled（無効な団体の再有効化）",
      },
    ])("$description は true を返す", ({ from, to }) => {
      expect(canChangeGroupStatus(from, to)).toBe(true);
    });
  });

  describe("許されない遷移（同一状態・pending への変更）", () => {
    it.each([
      {
        from: GroupStatus.Pending,
        to: GroupStatus.Pending,
        description: "pending -> pending（同一状態への変更）",
      },
      {
        from: GroupStatus.Enabled,
        to: GroupStatus.Enabled,
        description: "enabled -> enabled（同一状態への変更）",
      },
      {
        from: GroupStatus.Disabled,
        to: GroupStatus.Disabled,
        description: "disabled -> disabled（同一状態への変更）",
      },
      {
        from: GroupStatus.Enabled,
        to: GroupStatus.Pending,
        description: "enabled -> pending（pending への巻き戻し）",
      },
      {
        from: GroupStatus.Disabled,
        to: GroupStatus.Pending,
        description: "disabled -> pending（pending への巻き戻し）",
      },
    ])("$description は false を返す", ({ from, to }) => {
      expect(canChangeGroupStatus(from, to)).toBe(false);
    });
  });

  it("3×3 全 9 通りの網羅検証", () => {
    const statuses = [GroupStatus.Pending, GroupStatus.Enabled, GroupStatus.Disabled];
    const results: Record<string, boolean> = {};

    for (const from of statuses) {
      for (const to of statuses) {
        results[`${from}->${to}`] = canChangeGroupStatus(from, to);
      }
    }

    expect(results).toEqual({
      "pending->pending": false,
      "pending->enabled": true,
      "pending->disabled": true,
      "enabled->pending": false,
      "enabled->enabled": false,
      "enabled->disabled": true,
      "disabled->pending": false,
      "disabled->enabled": true,
      "disabled->disabled": false,
    });
  });
});
