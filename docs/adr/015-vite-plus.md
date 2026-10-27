# ADR-015: 開発のツールを Vite+ にまとめ、pnpm を 12 に上げる

## ステータス

提案 (2026-10-27)

Issue #246 を受けて決める。

## コンテキスト

- 開発のツールを別々に入れていた。Vite（開発サーバー・ビルド）・Vitest（単体テスト）・Oxlint（リント）・Oxfmt（フォーマット）・tsx（スクリプトの実行）。
  設定も `vite.config.ts`・`.oxlintrc.json`・`.oxfmtrc.json` に分かれ、版も 1 つずつ上げていた。
- [Vite+](https://viteplus.dev/)（`vite-plus`）が 1.0 で安定版になった（2026-09-28）。
  上の道具を 1 つのパッケージ・1 つのコマンド（`vp`）・1 つの設定ファイル（`vite.config.ts`）にまとめたもの。
- Vite+ の `vp` は、プロジェクトに pnpm の版が書かれていないと、最新の pnpm（12）を使う。CI は pnpm 11 で動かしていた。

## 決定

### 1. `vite-plus` を入れ、Vite・Vitest・Oxlint・Oxfmt・tsx を直接は入れない

- `vite` は Vite+ に入っている Vite（`@voidzero-dev/vite-plus-core`）に置き換える。
  React Router・Cloudflare・Tailwind のプラグインが読む `vite` も、`pnpm-workspace.yaml` の `overrides` でそろえる。
- テストの関数は `vite-plus/test` から読み込む。`vitest` から読み込むとリントで止まる（`vite-plus/prefer-vite-plus-imports`）。
- `scripts/` などの TypeScript は、tsx ではなく `vpx` で動かす。
- 版を上げるときは、`vite-plus` と `vite` の行を手で書き換えず `vp migrate` を使う
  （`pnpm dlx --package=vite-plus@<版> vp migrate --no-interactive`）。2 つの版がずれないようにするため。

### 2. 普段のコマンドは package.json のスクリプトのまま

| コマンド                               | 中身                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm test`                            | `vp test run`                                                            |
| `pnpm lint` / `pnpm run lint:fix`      | `vp lint` / `vp lint --fix`                                              |
| `pnpm format` / `pnpm run format:fix`  | `vp fmt --check .` / `vp fmt .`                                          |
| `pnpm run db:seed`・`pnpm run dev:otp` | `vpx scripts/…`                                                          |
| `pnpm run dev`・`pnpm run build`       | 今までどおり React Router のコマンド（中で Vite+ の Vite を使う）        |
| `pnpm typecheck`                       | 今までどおり（`wrangler types`・`react-router typegen` の後に `tsc -b`） |

- Vite+ のグローバルのコマンド（`vp`）は入れなくてよい。入れた人は `vp check`・`vp test` なども直接使える。

### 3. 型の情報を使うリントは、まだ有効にしない

- `vp migrate` は `lint.options.typeAware`・`lint.options.typeCheck` を有効にするが、外した。
  有効にすると、今のコードで 101 件のエラーが出るため
  （`unbound-method` 79 件・`no-floating-promises` 10 件・`no-misused-spread` 6 件・`no-base-to-string` 6 件）。
- 型の検査も `tsc -b` のまま。`typeCheck` で `vp lint` に型を見させるには、CI の Lint でも先に `react-router typegen` を動かす必要がある。
- リントの規則は移行の前と同じ（`correctness` をエラーにする）。増えたのは決定 1 の `prefer-vite-plus-imports` だけ。

### 4. コミットの前に、コミットするファイルを整える

- `vp migrate` の既定どおり、`pnpm install` のときに `prepare`（`vp config`）が Git のフックを入れ、
  コミットの前に `vp staged` を動かす。中身は `vp check --fix`（フォーマットと、リントで直せるところの修正）で、
  コミットするファイルだけが対象（`vite.config.ts` の `staged`、`.vite-hooks/pre-commit`）。
- CI でフォーマットだけが落ちることを減らすため。
- 1 回だけ止めるときは `VP_GIT_HOOKS=0 git commit`、その手元でずっと止めるときは `pnpm exec vp hooks disable`。

### 5. pnpm を 12 に上げ、版を package.json に書く

- `package.json` の `devEngines.packageManager` に `12.15.0` を書く。版を上げるときは、ここを書き換えて `pnpm install` する。
  pnpm は使う版を `pnpm-lock.yaml` の先頭にも書き、別の版の pnpm で動かしても、その版を落として切り替える（`onFail: download`）。
  Vite+ の `vp install` もこの版を使う。
- 範囲（`^12.15.0`）ではなく、決まった版を書く。範囲にすると、CI の `pnpm/setup` は範囲の中の最新（12.16.0）を入れる一方、
  pnpm はロックファイルの版（12.15.0）に従うため、`pnpm/setup` の版の確認で落ちた（この PR の最初の CI）。
- CI（`pnpm/setup@v2`）には `version` を書かず、package.json の `devEngines.packageManager` から読ませる。版を書くのは package.json の 1 か所だけにする。
- Cloudflare の Workers Builds のビルド変数 `PNPM_VERSION` も 12 にする（README の「Workers Builds のビルド変数」）。

### 6. CI の手順は今のまま

- Vite+ の `voidzero-dev/setup-vp` には切り替えず、今までどおり `pnpm/setup` で入れて、スクリプトを動かす。
  ジョブの名前（Format・Lint・Type Check・Test・E2E）と、ブランチのルールで必須にしているチェックを変えずに済むため。
- E2E のアプリは `vp preview` で起動する（`playwright.config.ts` の webServer）。
  Vite+ の `vite` には `bin/vite.js` が無いため、`node node_modules/vite-plus/bin/vp preview …` と書く。

## 採らなかった案

- **型の情報を使うリントをこの変更で有効にし、101 件を直す**: ツールの入れ替えとコードの書き換えが 1 つの PR に混ざり、レビューしにくい。別に行う。
- **CI を `setup-vp` に切り替える**: Node.js と pnpm を Vite+ が入れるようになるが、今の手順でも動き、得るものが少ない。
- **pnpm 11 のまま、版だけを書く**: 12 で install・リント・型の検査・単体テスト・ビルド・E2E が通ったので、Vite+ が既定で選ぶ 12 にそろえた。

## 影響

- `node_modules` から `vitest`・`oxlint`・`oxfmt`・`tsx` のコマンドが無くなる。手で動かすときは `pnpm exec vp test`・`pnpm exec vp lint`・`pnpm exec vpx <ファイル>` を使う。

## 残っていること

- 型の情報を使うリント（決定 3）を有効にする。
- Workers Builds の `PNPM_VERSION` を、ダッシュボードで 12 に変える（決定 5）。

## 関連

- Issue #246
- [ADR-007](./007-e2e-testing.md)（E2E のアプリの起動）
- [Vite+ の移行の手引き](https://viteplus.dev/guide/migrate)
