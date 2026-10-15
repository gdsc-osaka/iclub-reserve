import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * ホーム画面への追加（PWA）。方針は ADR-011（`docs/adr/011-pwa.md`）を参照。
 *
 * UC に属さない、アプリ全体の仕組みなので、UC の番号ではなく `@PWA` のタグを付けている。
 */
test.describe("PWA ホーム画面への追加", { tag: "@PWA" }, () => {
  test("ログインしていなくても、ホーム画面に追加するための情報とアイコンを取れる", async ({
    page,
    request,
  }) => {
    // ブラウザは manifest を Cookie なしで取りに来る。ログイン必須にすると取れなくなる
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.status()).toBe(200);

    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({
      name: "i-Club 予約システム",
      short_name: "i-Club 予約",
      start_url: "/",
      display: "standalone",
    });

    for (const { src } of manifest.icons as { src: string }[]) {
      const iconResponse = await request.get(src);
      expect(iconResponse.status(), src).toBe(200);
      expect(iconResponse.headers()["content-type"], src).toBe("image/png");
    }

    // ログイン画面からも manifest を参照している。Cloudflare Access の内側にある
    // ブランチのプレビューでも読めるよう、Cookie 付きで取りに行かせる（ADR-011）
    await openPage(page, "/login");
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(manifestLink).toHaveAttribute("crossorigin", "use-credentials");
  });

  test("電波が無いときは、前に開いた画面ではなく、つながっていない旨の画面を出す", async ({
    page,
    context,
    db,
    signInAs,
    browserName,
  }) => {
    // 通信を止めたときに Service Worker を通る動きを確かめられるのは Chromium だけ
    test.skip(browserName !== "chromium", "オフラインの再現は Chromium でだけ確かめる");

    const user = await createUser(db);
    await signInAs(user.id);

    await openPage(page, "/");
    await expect(page).toHaveTitle(/ダッシュボード/);

    /*
     * Service Worker が動き出して、この画面を受け持つまで待つ。
     * E2E の型の設定（tsconfig.node.json）には DOM の型が無いので、
     * ブラウザで評価する式を文字列で渡している。
     */
    await page.waitForFunction("navigator.serviceWorker.controller !== null");

    // 通信を止めて開き直すと、さっきのダッシュボードの写しではなく、オフラインの画面が出る
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "インターネットにつながっていません" }),
    ).toBeVisible();
    await expect(page).toHaveURL("/");

    // 通信が戻ってから読み込み直すと、ダッシュボードに戻る
    await context.setOffline(false);
    await page.getByRole("button", { name: "再読み込み" }).click();
    await expect(page).toHaveTitle(/ダッシュボード/);
  });
});
