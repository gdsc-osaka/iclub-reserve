import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";
import { isStaffAreaForbidden } from "./staff-area-forbidden";

/** loader が投げた応答（`isRouteErrorResponse` が見分ける形） */
const routeError = (status: number) => ({ status, statusText: "", internal: false, data: {} });

describe("isStaffAreaForbidden", () => {
  it("事務局の画面の 403 なら true", () => {
    expect(isStaffAreaForbidden(routeError(403), AppArea.Staff)).toBe(true);
  });

  it.each([
    ["利用者の画面の 403（変更できない予約など）", routeError(403), AppArea.User],
    ["事務局の画面の 404", routeError(404), AppArea.Staff],
    ["事務局の画面の、応答でない例外", new Error("boom"), AppArea.Staff],
  ])("%s なら false", (_, error, area) => {
    expect(isStaffAreaForbidden(error, area)).toBe(false);
  });
});
