import type { Page } from "@playwright/test";
import { readLatestSignInCode } from "../support/auth.js";
import type { E2eDb } from "../support/db.js";
import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { waitForHydration } from "../support/page.js";

/**
 * UC-020 ログインする（`rdra/contexts/user-authentication.md`）
 *
 * ログインそのものを確かめるので、ほかのテストと違って `signInAs` は使わず、
 * 画面で認証コードを入れてログインする。
 */

/** ログイン画面でメールアドレスを入れ、届いた認証コードを入れてログインする */
async function signInWithCode(page: Page, db: E2eDb, email: string): Promise<void> {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "メールアドレスで続ける" }).click();

  // 認証コードの入力欄が出るのは、送信が終わってから。
  // 出る前に DB を読むと、前に送った古い認証コードを読んでしまうことがある。
  const codeInput = page.getByLabel("認証コード");
  await expect(codeInput).toBeVisible();

  const code = await readLatestSignInCode(db, email);
  expect(code, "認証コードが DB に保存されていない").not.toBeNull();

  await codeInput.fill(code ?? "");
  await page.getByRole("button", { name: "認証する" }).click();
}

test.describe("UC-020 ログインする", { tag: "@UC-020" }, () => {
  test("登録済みの人が認証コードでログインできる", async ({ page, db }) => {
    const user = await createUser(db);

    await page.goto("/login");
    await waitForHydration(page);
    await signInWithCode(page, db, user.email);

    // ダッシュボードに移り、画面の隅のアカウントのメニューに本人が出る
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: new RegExp(user.email) })).toBeVisible();
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
});
