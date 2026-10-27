import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";

import { toAvailableAreas } from "./app-area";

describe("toAvailableAreas", () => {
  it("事務局スタッフには利用者と事務局の両方を返す", () => {
    const areas = toAvailableAreas({ isStaff: true });
    expect(areas.map((link) => link.area)).toEqual([AppArea.User, AppArea.Staff]);
  });

  it("事務局以外のユーザーには利用者の画面のみを返す", () => {
    const areas = toAvailableAreas({ isStaff: false });
    expect(areas.map((link) => link.area)).toEqual([AppArea.User]);
  });
});
