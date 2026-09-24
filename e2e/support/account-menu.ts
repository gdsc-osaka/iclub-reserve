import { expect, type Page } from "@playwright/test";

/**
 * 画面のアカウントのメニュー（ログイン中の人とログアウト）を扱う。
 *
 * 置き場所が画面の幅で変わるので、テストはこのファイルの関数を使い、`isMobile`（Playwright の fixture）を渡す。
 * - パソコンの幅: サイドバーの下のアカウントのボタン。押すとメニューが開く
 * - スマホの幅: サイドバーが無く、ボトムバーの「その他」を押すと下からシートが開く
 *
 * @example
 * test("…", async ({ page, isMobile }) => {
 *   await expectSignedInAs(page, isMobile, user.email);
 * });
 */

/** パソコンの幅で出る、アカウントのボタン。名前にログイン中の人のメールアドレスが入っている */
const accountButton = (page: Page, email: string) =>
  page.getByRole("button", { name: new RegExp(email) });

/** スマホの幅で、ボトムバーの「その他」を押してシートを開き、そのシートを返す */
async function openMobileMenu(page: Page) {
  await page
    .getByRole("navigation", { name: "メインメニュー" })
    .getByRole("button", { name: "その他" })
    .click();
  return page.getByRole("dialog", { name: "メニュー" });
}

/** ログイン中の人として、アカウントのメニューにこのメールアドレスが出ていることを確かめる */
export async function expectSignedInAs(page: Page, isMobile: boolean, email: string) {
  if (isMobile) {
    const menu = await openMobileMenu(page);
    await expect(menu.getByText(email)).toBeVisible();
    return;
  }
  await expect(accountButton(page, email)).toBeVisible();
}

/** アカウントのメニューからログアウトする */
export async function signOutFromMenu(page: Page, isMobile: boolean, email: string) {
  if (isMobile) {
    const menu = await openMobileMenu(page);
    await menu.getByRole("button", { name: "ログアウト" }).click();
    return;
  }
  await accountButton(page, email).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
}
