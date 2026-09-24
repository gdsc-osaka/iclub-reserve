import { expectSignedInAs } from "../support/account-menu.js";
import { signInWithCode } from "../support/auth.js";
import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage, waitForHydration } from "../support/page.js";
import { addVirtualAuthenticator, disablePasskeyAutofill } from "../support/passkey.js";

/**
 * UC-020 ログインする（`rdra/contexts/user-authentication.md`）
 *
 * ログインそのものを確かめるので、ほかのテストと違って `signInAs` は使わず、
 * 画面で認証コードやパスキーを使ってログインする。
 */
test.describe("UC-020 ログインする", { tag: "@UC-020" }, () => {
  test("登録済みの人が認証コードでログインできる", async ({ page, db, isMobile }) => {
    const user = await createUser(db);

    await openPage(page, "/login");
    await signInWithCode(page, db, user.email);

    // ダッシュボードに移り、アカウントのメニューに本人が出る
    await expect(page).toHaveURL("/");
    await expectSignedInAs(page, isMobile, user.email);
  });

  test("ログインが要る画面から来た人は、ログインの後に元の画面へ戻る", async ({ page, db }) => {
    const user = await createUser(db);

    // ログインせずに予約一覧を開くと、ログイン画面に送られる
    await page.goto("/reservations");
    await expect(page).toHaveURL("/login?redirectTo=%2Freservations");
    await waitForHydration(page);

    await signInWithCode(page, db, user.email);

    await expect(page).toHaveURL("/reservations");
  });

  test("パスキーを登録した人が、パスキーでログインできる", async ({
    page,
    context,
    db,
    signInAs,
    webAuthn,
    isMobile,
  }) => {
    const user = await createUser(db);
    await addVirtualAuthenticator(webAuthn);
    // ボタンを押す前に、自動入力でログインが終わらないようにする
    await disablePasskeyAutofill(page);

    // 前提: アカウント設定からパスキーを登録しておく。
    // 鍵は認証器の中で作られるので、ほかの前提と違って DB に直接は入れられない。
    await signInAs(user.id);
    await openPage(page, "/account");
    await page.getByRole("button", { name: "パスキーを追加" }).click();
    await expect(page.getByText("パスキーを登録しました。")).toBeVisible();

    // ログアウトした状態に戻す
    await context.clearCookies();

    await openPage(page, "/login");
    await page.getByRole("button", { name: "パスキーでログイン" }).click();

    await expect(page).toHaveURL("/");
    await expectSignedInAs(page, isMobile, user.email);
  });
});
