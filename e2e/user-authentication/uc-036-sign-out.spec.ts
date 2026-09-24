import { eq } from "drizzle-orm";
import { session } from "~/db/schema";
import { signOutFromMenu } from "../support/account-menu.js";
import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-036 ログアウトする（`rdra/contexts/user-authentication.md`）
 */
test.describe("UC-036 ログアウトする", { tag: "@UC-036" }, () => {
  test("ログアウトするとログイン画面に戻り、ログインが要る画面を開けなくなる", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    const user = await createUser(db);
    await signInAs(user.id);

    // アカウントのメニューからログアウトする
    await openPage(page, "/");
    await signOutFromMenu(page, isMobile, user.email);

    await expect(page).toHaveURL("/login");
    const rows = await db.select().from(session).where(eq(session.userId, user.id));
    expect(rows).toHaveLength(0);

    // ログインが要る画面を開くと、ログイン画面に送られる
    await page.goto("/reservations");
    await expect(page).toHaveURL("/login?redirectTo=%2Freservations");
  });
});
