import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

/**
 * ローカルの D1・R2 などの状態を置くフォルダ。
 *
 * 普段は既定の `.wrangler/state` を使う。E2E テスト（`playwright.config.ts`）は
 * `E2E_PERSIST_TO` で別のフォルダを渡し、開発中のデータを壊さずに毎回作り直す。
 * wrangler の `--persist-to` と同じく、プラグインはこのフォルダの下に `v3` を足して置く。
 */
const persistState = process.env.E2E_PERSIST_TO ? { path: process.env.E2E_PERSIST_TO } : true;

/**
 * Vite+ の設定。開発サーバー・ビルド（Vite）に加えて、テスト（`vp test`）・リント（`vp lint`）・
 * フォーマット（`vp fmt`）・コミット前の確認（`vp staged`）の設定も、このファイルにまとめる。
 */
export default defineConfig({
  /*
   * コミットの前に、コミットするファイルだけをフォーマットし、リントで直せるところを直す
   * （`.vite-hooks/pre-commit`）。止めたいときは `VP_GIT_HOOKS=0 git commit` か `vp hooks disable`。
   */
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [".agents/*"],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    rules: {
      // テストの関数などは `vitest` ではなく `vite-plus/test` から読み込む
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    env: {
      builtin: true,
    },
    /*
     * 型の情報を使うリント（`options.typeAware`・`options.typeCheck`）は、まだ有効にしていない。
     * 有効にすると、今のコードで通らない規則（`unbound-method` など）が出るため。
     * 型の検査は、今までどおり `pnpm typecheck`（`tsc -b`）で行う。
     */
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  /*
   * `lazyPlugins` で包むと、`vp lint`・`vp fmt` のように設定の一部だけを読むコマンドでは
   * プラグインを作らずに済む。開発サーバー・ビルド・テストでは、今までどおりプラグインが動く。
   */
  plugins: lazyPlugins(() => [
    !process.env.VITEST && cloudflare({ viteEnvironment: { name: "ssr" }, persistState }),
    tailwindcss(),
    reactRouter(),
  ]),
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
