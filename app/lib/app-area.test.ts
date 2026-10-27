import { describe, expect, it } from "vite-plus/test";

import {
  AppArea,
  parseAppArea,
  resolveShellArea,
  toAreaDashboardPath,
  toAreaFromPathname,
  toAreaSwitchPath,
  toSharedScreenPath,
} from "./app-area";

describe("toAreaFromPathname", () => {
  it.each([
    ["/staff", AppArea.Staff],
    ["/staff/", AppArea.Staff],
    ["/staff/reservations", AppArea.Staff],
    ["/staff/availability", AppArea.Staff],
    ["/staff/reservations/abc", AppArea.Staff],
    ["/staff/groups/abc", AppArea.Staff],
    ["/", AppArea.User],
    ["/availability", AppArea.User],
    ["/reservations", AppArea.User],
    ["/reservations/new", AppArea.User],
    ["/reservations/abc", AppArea.User],
    ["/reservations/abc/edit", AppArea.User],
    ["/groups", AppArea.User],
    ["/groups/new", AppArea.User],
    ["/groups/abc", AppArea.User],
    ["/staff-invitations/x", null],
    ["/staffx", null],
    ["/invitations/abc", null],
    ["/account", null],
    ["/availabilityx", null],
    ["/groupsx", null],
  ])("%s のときは %s を返す", (pathname, expected) => {
    expect(toAreaFromPathname(pathname)).toBe(expected);
  });
});

describe("toSharedScreenPath", () => {
  it.each([
    [AppArea.User, "/availability", "/availability"],
    [AppArea.Staff, "/availability", "/staff/availability"],
    [AppArea.User, "/reservations/123", "/reservations/123"],
    [AppArea.Staff, "/reservations/123", "/staff/reservations/123"],
    [AppArea.User, "/groups/456", "/groups/456"],
    [AppArea.Staff, "/groups/456", "/staff/groups/456"],
  ])("%s と %s で %s を返す", (area, path, expected) => {
    expect(toSharedScreenPath(area, path)).toBe(expected);
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

describe("toAreaSwitchPath", () => {
  it.each([
    // 両方に置く画面は、もう一方の画面の同じものへ移す
    [AppArea.Staff, "/reservations/abc", "", "/staff/reservations/abc"],
    [AppArea.User, "/staff/reservations/abc", "", "/reservations/abc"],
    [AppArea.Staff, "/groups/grp-123", "", "/staff/groups/grp-123"],
    [AppArea.User, "/staff/groups/grp-123", "", "/groups/grp-123"],
    [AppArea.Staff, "/availability", "", "/staff/availability"],
    [AppArea.User, "/staff/availability", "", "/availability"],
    // 予約の詳細・団体管理のクエリは引き継がない
    [AppArea.Staff, "/reservations/abc", "?page=2", "/staff/reservations/abc"],
    [AppArea.User, "/staff/groups/grp-123", "?page=2", "/groups/grp-123"],
    // 空き状況は施設と日だけを引き継ぎ、欄で開いているものは引き継がない（ADR-016 決定 16）
    [
      AppArea.Staff,
      "/availability",
      "?facility=f1&date=2026-10-27&reservation=r1",
      "/staff/availability?facility=f1&date=2026-10-27",
    ],
    [
      AppArea.User,
      "/staff/availability",
      "?date=2026-10-27&draft=2026-10-27T10%3A00-11%3A00&facility=f1",
      "/availability?facility=f1&date=2026-10-27",
    ],
    [
      AppArea.User,
      "/staff/availability",
      "?edit=r1&date=2026-10-27",
      "/availability?date=2026-10-27",
    ],
    // 作成と変更の入口は、開くとすぐ空き状況へ転送するので、ダッシュボードへ移す
    [AppArea.Staff, "/reservations/new", "", "/staff"],
    [AppArea.User, "/staff/reservations/new", "", "/"],
    [AppArea.Staff, "/reservations/abc/edit", "", "/staff"],
    [AppArea.User, "/staff/reservations/abc/edit", "", "/"],
    [AppArea.Staff, "/groups/new", "", "/staff"],
    // 移る先と同じ画面を開いているときは、そのダッシュボードへ移す
    [AppArea.Staff, "/staff/reservations/abc", "", "/staff"],
    [AppArea.User, "/reservations/abc", "", "/"],
    [AppArea.User, "/availability", "?facility=f1", "/"],
    // ダッシュボードの行き来
    [AppArea.Staff, "/", "", "/staff"],
    [AppArea.User, "/staff", "", "/"],
    // 一覧は利用者の画面と事務局の画面で別の画面なので、ダッシュボードへ移す
    [AppArea.Staff, "/reservations", "?status=provisional", "/staff"],
    [AppArea.User, "/staff/reservations", "", "/"],
    [AppArea.Staff, "/groups", "", "/staff"],
    [AppArea.User, "/staff/groups", "", "/"],
    // どちらにも属さない画面と、事務局だけの画面
    [AppArea.Staff, "/account", "", "/staff"],
    [AppArea.User, "/account", "", "/"],
    [AppArea.Staff, "/staff-invitations/x", "", "/staff"],
    [AppArea.User, "/staff-invitations/x", "", "/"],
    [AppArea.User, "/staff/facilities", "", "/"],
    [AppArea.User, "/staff/audit-log", "", "/"],
  ])("%s へ切り替えると、%s%s から %s へ移る", (target, pathname, search, expected) => {
    expect(toAreaSwitchPath(target, { pathname, search })).toBe(expected);
  });
});

describe("toAreaDashboardPath", () => {
  it.each([
    [AppArea.User, "/"],
    [AppArea.Staff, "/staff"],
  ])("%s のダッシュボードは %s", (area, expected) => {
    expect(toAreaDashboardPath(area)).toBe(expected);
  });
});
