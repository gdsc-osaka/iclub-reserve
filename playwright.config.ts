import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PERSIST_TO, E2E_PORT } from "./e2e/support/e2e-env";

/**
 * E2E テスト（Playwright）の設定。方針は ADR-007（`docs/adr/007-e2e-testing.md`）を参照。
 *
 * 動かし方: `pnpm run test:e2e`（ビルドしてから、下の 5 種類のブラウザで全テストを実行する）
 * ビルド済みなら `pnpm exec playwright test` だけでもよい。
 * 1 種類だけで動かすときは `pnpm exec playwright test --project=chromium` のように選ぶ。
 */
export default defineConfig({
  testDir: "./e2e",

  /*
   * テストは 1 つずつ順に動かす。
   * データはテストごとに作っているので並列にもできるが、まずは失敗を読みやすくすることを優先する。
   */
  fullyParallel: false,
  workers: 1,

  // `test.only` を消し忘れたまま push したら、CI で落とす
  forbidOnly: !!process.env.CI,

  // 落ちたテストはやり直さない。たまに落ちるテストは、やり直しで隠さずに直す
  retries: 0,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: E2E_BASE_URL,
    // 利用者と同じく、日本語・日本時間のブラウザで開く
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    // 落ちたテストだけ、操作の記録（trace）と画面の写真を残す
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  /*
   * 同じテストを、パソコンの 3 種類のブラウザと、スマホの 2 種類で動かす。
   * スマホは画面の幅が狭く、ナビゲーションがボトムバーに、空き状況が日ごとの一覧に変わる。
   * 画面によって操作が変わるテストは、Playwright の `isMobile` を見て分けている。
   *
   * パスキーの仮想の認証器は Chromium でしか使えないので、それを使うテストは
   * Firefox・WebKit・スマホの Safari では飛ばされる（`e2e/support/fixtures.ts` の `webAuthn`）。
   *
   * CI では、ブラウザごとに別のジョブで並行して動かす（`.github/workflows/ci.yml`）。
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],

  /*
   * テストの前に、ビルド済みのアプリを E2E 用の DB で起動する。
   *
   * 開発サーバー（`pnpm run dev`）は使わない。初めて開く画面で依存の最適化が走り、
   * 画面が勝手に読み込み直されて操作が失敗することがあるため（ADR-007）。
   * `e2e/prepare.ts` が E2E 用の設定を置き、DB を作り直してから `vite preview` を起動する。
   *
   * コマンドは `node` で直接動かす。次の 2 つを避けるため。
   * - `pnpm exec` を挟むと、pnpm 11 では `vite preview` が Playwright の管理から外れ、
   *   テストが終わってもアプリが止まらず、Playwright が終わらなくなる
   * - `./node_modules/.bin/…` の書き方は、Windows（コマンドプロンプト）では動かない
   */
  webServer: {
    command: `node --import tsx e2e/prepare.ts && node node_modules/vite/bin/vite.js preview --port ${E2E_PORT} --strictPort`,
    url: `${E2E_BASE_URL}/login`,
    env: { E2E_PERSIST_TO },
    // 前のテストのデータが残ったアプリを使わないよう、毎回起動し直す
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
