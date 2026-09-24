import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PERSIST_TO, E2E_PORT } from "./e2e/support/e2e-env";

/**
 * E2E テスト（Playwright）の設定。方針は ADR-007（`docs/adr/007-e2e-testing.md`）を参照。
 *
 * 動かし方: `pnpm run test:e2e`（ビルドしてから全テストを実行する）
 * ビルド済みなら `pnpm exec playwright test` だけでもよい。
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

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /*
   * テストの前に、ビルド済みのアプリを E2E 用の DB で起動する。
   *
   * 開発サーバー（`pnpm run dev`）は使わない。初めて開く画面で依存の最適化が走り、
   * 画面が勝手に読み込み直されて操作が失敗することがあるため（ADR-007）。
   * `e2e/prepare.ts` が E2E 用の設定を置き、DB を作り直してから `vite preview` を起動する。
   *
   * ここでは `pnpm exec` を使わず、`node_modules/.bin` のコマンドを直接呼ぶ。
   * pnpm 11 の `pnpm exec` を挟むと `vite preview` が Playwright の管理から外れ、
   * テストが終わってもアプリが止まらず、Playwright が終わらなくなるため。
   */
  webServer: {
    command: `./node_modules/.bin/tsx e2e/prepare.ts && ./node_modules/.bin/vite preview --port ${E2E_PORT} --strictPort`,
    url: `${E2E_BASE_URL}/login`,
    env: { E2E_PERSIST_TO },
    // 前のテストのデータが残ったアプリを使わないよう、毎回起動し直す
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
