import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

/**
 * ローカルの D1・R2 などの状態を置くフォルダ。
 *
 * 普段は既定の `.wrangler/state` を使う。E2E テスト（`playwright.config.ts`）は
 * `E2E_PERSIST_TO` で別のフォルダを渡し、開発中のデータを壊さずに毎回作り直す。
 * wrangler の `--persist-to` と同じく、プラグインはこのフォルダの下に `v3` を足して置く。
 */
const persistState = process.env.E2E_PERSIST_TO ? { path: process.env.E2E_PERSIST_TO } : true;

export default defineConfig({
  plugins: [
    !process.env.VITEST && cloudflare({ viteEnvironment: { name: "ssr" }, persistState }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    /*
     * テストは app 配下にしか置かない。既定の include (リポジトリ全体) のままだと、
     * .claude/worktrees/* や .worktree/* にある別の git worktree のテストまで拾ってしまう。
     */
    include: ["app/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    server: {
      deps: {
        /*
         * better-auth は Node の ES モジュール解決では読み込めない依存
         * (@opentelemetry/semantic-conventions のディレクトリ import) を含む。
         * Vite に変換させると Node 形式の解決が使われて読み込めるようになる。
         */
        inline: [/better-auth/],
      },
    },
  },
});
