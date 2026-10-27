import { describe, expect, it } from "vite-plus/test";

import {
  AppArea,
  parseAppArea,
  resolveShellArea,
  toAreaFromPathname,
  toAvailableAreas,
} from "./app-area";

describe("toAreaFromPathname", () => {
  it.each([
    ["/staff", AppArea.Staff],
    ["/staff/", AppArea.Staff],
    ["/staff/reservations", AppArea.Staff],
    ["/", AppArea.User],
    ["/reservations", AppArea.User],
    ["/groups", AppArea.User],
    ["/groups/new", AppArea.User],
    ["/staff-invitations/x", null],
    ["/staffx", null],
    ["/reservations/new", null],
    ["/reservations/abc", null],
    ["/groups/abc", null],
    ["/account", null],
    ["/availability", null],
  ])("%s のときは %s を返す", (pathname, expected) => {
    expect(toAreaFromPathname(pathname)).toBe(expected);
  });
});

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

describe("resolveShellArea", () => {
  it("事務局でなければ、パスや前回の記録に関係なく常に利用者の画面を返す", () => {
    expect(
      resolveShellArea({ isStaff: false, pathArea: AppArea.Staff, lastArea: AppArea.Staff }),
    ).toBe(AppArea.User);
    expect(resolveShellArea({ isStaff: false, pathArea: null, lastArea: null })).toBe(AppArea.User);
  });

  it("事務局なら、pathArea があればそれを優先する", () => {
    expect(
      resolveShellArea({ isStaff: true, pathArea: AppArea.User, lastArea: AppArea.Staff }),
    ).toBe(AppArea.User);
    expect(
      resolveShellArea({ isStaff: true, pathArea: AppArea.Staff, lastArea: AppArea.User }),
    ).toBe(AppArea.Staff);
  });

  it("事務局で pathArea が null のときは、lastArea を使う", () => {
    expect(resolveShellArea({ isStaff: true, pathArea: null, lastArea: AppArea.User })).toBe(
      AppArea.User,
    );
    expect(resolveShellArea({ isStaff: true, pathArea: null, lastArea: AppArea.Staff })).toBe(
      AppArea.Staff,
    );
  });

  it("事務局で pathArea も lastArea も null のときは、既定として事務局の画面を返す", () => {
    expect(resolveShellArea({ isStaff: true, pathArea: null, lastArea: null })).toBe(AppArea.Staff);
  });
});

describe("parseAppArea", () => {
  it.each([
    ["user", AppArea.User],
    ["staff", AppArea.Staff],
  ])("%s のときは AppArea を返す", (value, expected) => {
    expect(parseAppArea(value)).toBe(expected);
  });

  it.each([[null], [""], ["admin"], ["User"], ["Staff"], ["other"]])(
    "%s のときは null を返す",
    (value) => {
      expect(parseAppArea(value)).toBeNull();
    },
  );
});
