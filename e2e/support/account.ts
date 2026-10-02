import type { Locator, Page } from "@playwright/test";

/** アカウント設定（SCR-021）に並ぶカードの見出し */
export type AccountCardTitle = "氏名" | "メールアドレス" | "パスキー" | "ログイン中の端末";

/**
 * アカウント設定（SCR-021、`/account`）の画面で、見出しが `title` のカードを探す。
 *
 * この画面には「変更」「ログアウト」のように、同じ名前のボタンが複数のカードにある。
 * そこで、先にカードで絞ってからボタンを探す。
 *
 * カードは見出し（heading）を持たないので、shadcn/ui のカードが付ける `data-slot` の印で探す。
 *
 * @example
 * await accountCard(page, "氏名").getByRole("button", { name: "変更" }).click();
 */
export function accountCard(page: Page, title: AccountCardTitle): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]').getByText(title, { exact: true }),
  });
}
