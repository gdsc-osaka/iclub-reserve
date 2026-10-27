import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";
import { requireRequestUser, type SessionUser } from "~/lib/auth/auth-session.server";
import { requireAreaUser, toAreaWhere } from "./app-area.server";

vi.mock("~/lib/auth/auth-session.server", () => ({
  requireRequestUser: vi.fn(),
}));

/** ログイン中の人。事務局かどうかだけを変える */
const sessionUser = (id: string, isStaff: boolean): SessionUser => ({
  id,
  name: "テスト 太郎",
  email: `${id}@example.com`,
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
  is_staff: isStaff,
  terms_version: "1",
  terms_accepted_at: new Date("2026-04-01T00:00:00Z"),
});

describe("requireAreaUser", () => {
  const context = new RouterContextProvider();

  it("利用者の画面では、事務局であっても actsAsStaff: false を返す", async () => {
    vi.mocked(requireRequestUser).mockReturnValue(sessionUser("usr_staff", true));

    const result = await requireAreaUser(context, AppArea.User, "test");
    expect(result.actsAsStaff).toBe(false);
    expect(result.user.id).toBe("usr_staff");
  });

  it("利用者の画面では、一般ユーザーで actsAsStaff: false を返す", async () => {
    vi.mocked(requireRequestUser).mockReturnValue(sessionUser("usr_normal", false));

    const result = await requireAreaUser(context, AppArea.User, "test");
    expect(result.actsAsStaff).toBe(false);
    expect(result.user.id).toBe("usr_normal");
  });

  it("事務局の画面では、事務局なら actsAsStaff: true を返す", async () => {
    vi.mocked(requireRequestUser).mockReturnValue(sessionUser("usr_staff", true));

    const result = await requireAreaUser(context, AppArea.Staff, "test");
    expect(result.actsAsStaff).toBe(true);
    expect(result.user.id).toBe("usr_staff");
  });

  it("事務局の画面では、事務局でなければ 403 の Response が投げられる", async () => {
    vi.mocked(requireRequestUser).mockReturnValue(sessionUser("usr_normal", false));

    await expect(requireAreaUser(context, AppArea.Staff, "test")).rejects.toMatchObject({
      init: { status: 403 },
    });
  });
});

describe("toAreaWhere", () => {
  it.each([
    [AppArea.User, "reservations.detail.loader"],
    [AppArea.Staff, "staff-reservations.detail.loader"],
  ])("%s の画面では %s になる", (area, expected) => {
    expect(toAreaWhere(area, "reservations.detail.loader")).toBe(expected);
  });
});
