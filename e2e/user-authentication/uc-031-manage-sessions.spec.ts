import { eq } from "drizzle-orm";
import { session } from "~/db/schema";
import { accountCard } from "../support/account.js";
import { createSession, createUser, UserAgents } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-031 ログイン中の端末を管理する（`rdra/contexts/user-authentication.md`）
 *
 * ほかの端末でのログインは、DB に直接入れる（`createSession`）。
 * 端末の名前はブラウザの種類から決まるので、テストを動かすパソコンと違う名前になるものを使う。
 */
test.describe("UC-031 ログイン中の端末を管理する", { tag: "@UC-031" }, () => {
  test("ほかの端末を選んでログアウトさせると、その端末が一覧から消える", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const otherDevice = await createSession(db, {
      userId: user.id,
      userAgent: UserAgents.androidChrome,
    });
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "ログイン中の端末");
    await expect(card.getByText("この端末", { exact: true })).toBeVisible();
    await expect(card.getByText("Android の Chrome", { exact: true })).toBeVisible();

    // 「ログアウト」のボタンは、ほかの端末の行にだけある。この端末の行には無い
    const logoutButton = card.getByRole("button", { name: "ログアウト", exact: true });
    await expect(logoutButton).toHaveCount(1);
    await logoutButton.click();

    const dialog = page.getByRole("dialog", { name: "端末からログアウトしますか？" });
    await expect(dialog.getByText("「Android の Chrome」をログアウトします。")).toBeVisible();
    await dialog.getByRole("button", { name: "ログアウトする" }).click();

    await expect(page.getByText("端末をログアウトしました。")).toBeVisible();
    await expect(card.getByText("Android の Chrome", { exact: true })).toBeHidden();
    await expect(card.getByText("この端末", { exact: true })).toBeVisible();

    const rows = await db.select().from(session).where(eq(session.id, otherDevice.id));
    expect(rows).toHaveLength(0);
  });

  test("この端末以外をまとめてログアウトさせられる", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    await createSession(db, { userId: user.id, userAgent: UserAgents.androidChrome });
    await createSession(db, { userId: user.id, userAgent: UserAgents.iPadSafari });
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "ログイン中の端末");
    await card.getByRole("button", { name: "この端末以外をすべてログアウト" }).click();

    const dialog = page.getByRole("dialog", { name: "他のすべての端末からログアウトしますか？" });
    await expect(dialog.getByText(/（2 台）/)).toBeVisible();
    await dialog.getByRole("button", { name: "ログアウトする" }).click();

    await expect(page.getByText("この端末以外をすべてログアウトしました。")).toBeVisible();
    await expect(card.getByText("Android の Chrome", { exact: true })).toBeHidden();
    await expect(card.getByText("iPad の Safari", { exact: true })).toBeHidden();
    await expect(card.getByText("この端末", { exact: true })).toBeVisible();

    // DB に残るのは、この端末のログインだけ
    const rows = await db.select().from(session).where(eq(session.userId, user.id));
    expect(rows).toHaveLength(1);
  });
});
