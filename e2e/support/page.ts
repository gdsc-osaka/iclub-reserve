import type { Page } from "@playwright/test";

/**
 * 画面が操作できる状態になるまで待つ。
 *
 * サーバーが描いた HTML は、ブラウザで React の読み込み（hydration）が終わるまで
 * ボタンを押しても反応しないことがある。Playwright はボタンが「見えている」ことしか
 * 待たないので、そのまま押すと何も起きずにテストが落ちる。
 * `app/root.tsx` が読み込みの終わりに付ける `<html data-hydrated="true">` を待つ。
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
}

/**
 * 画面を開き、操作できる状態になるまで待つ。
 *
 * テストで画面を開くときは `page.goto` ではなく、必ずこれを使う。
 * 開いた後のリンクやボタンでの画面の移り変わりは、React が受け持つので待たなくてよい。
 */
export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
}
