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

### 3. 型の情報を使うリントと型の検査も `vp lint` で行う

- `lint.options.typeAware`（型の情報を使うリント）と `lint.options.typeCheck`（型の検査）を有効にする。Vite+ の勧めどおり。
  最初の移行（#247）では、出たエラーを直す変更が混ざらないよう外しておき、続く変更で有効にした。
- 規則は `correctness` をエラーにしたまま。型の情報を使う規則のうち `correctness` に入るものが加わった。
  有効にして出た 101 件は、次のように直した。

  | 規則                   | 件数 | 直し方                                                                                                                                                                                       |
  | ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `unbound-method`       | 79   | すべてテストの `expect(fake.method)`・`vi.mocked(fake.method)`。偽物（`vi.fn`）は `this` を使わないので、テストのファイルでだけ規則を切る（`lint.overrides`）                                |
  | `no-floating-promises` | 10   | `fetcher.submit`・`revalidator.revalidate` に `void` を付ける（`void navigate(...)` と同じ書き方）                                                                                           |
  | `no-misused-spread`    | 6    | 文字数はコードポイントで数える決まり（COND-023 など）なので、`[...s]` を同じ結果になる `Array.from(s)` に書き換える                                                                          |
  | `no-base-to-string`    | 6    | フォームの値は `typeof` で文字列か確かめる。`last_error` に残す原因は、オブジェクトなら JSON にする（`app/infra/format-last-error.ts`。それまでは `[object Object]` になり中身が消えていた） |

- `unbound-method` を切るのはテストだけ。アプリのコードでは今までどおり止める。
  ESLint ならテスト向けの規則（`jest/unbound-method`）で `expect` に渡すだけの場合を見分けられるが、oxlint には無い。
- リントは React Router と wrangler が生成した型（`.react-router/types`・`worker-configuration.d.ts`）を読む。
  無いと「`./+types/route` が見つからない」で止まるので、`postinstall` で `wrangler types` に加えて `react-router typegen` も動かす。
  ルートを足したときは `pnpm run dev` の間に作り直されるが、そうでなければ `pnpm typecheck` で作り直す。
  `worker-configuration.d.ts` は `pnpm run dev` の間も作り直されないので、`wrangler.jsonc` を変えたときも `pnpm typecheck` で作り直す。
  - pnpm は、入れるものが変わっていないと install を飛ばし、`postinstall` も動かさない。CI はまっさらな状態から入れるので動く。
- `pnpm typecheck`（`tsc -b`）と CI の Type Check は残す。ブランチのルールで必須にしているチェックで、
  `tsconfig` の参照のとおりに確かめるため。型のエラーは Lint と Type Check の両方で出る。

### 4. コミットの前に、コミットするファイルを整える

- `vp migrate` の既定どおり、`pnpm install` のときに `prepare`（`vp config`）が Git のフックを入れ、
  コミットの前に `vp staged` を動かす。中身は `vp check --fix`（フォーマット・リントで直せるところの修正・型の検査）で、
  コミットするファイルだけが対象（`vite.config.ts` の `staged`、`.vite-hooks/pre-commit`）。
- CI でフォーマットだけが落ちることを減らすため。
- 1 回だけ止めるときは `VP_GIT_HOOKS=0 git commit`、その手元でずっと止めるときは `pnpm exec vp hooks disable`。

### 5. pnpm を 12 に上げ、版を package.json に書く

- `package.json` の `devEngines.packageManager` に `12.15.0` を書く。版を上げるときは、ここを書き換えて `pnpm install` する。
  pnpm は使う版を `pnpm-lock.yaml` の先頭にも書き、別の版の pnpm で動かしても、その版を落として切り替える（`onFail: download`）。
  Vite+ の `vp install` もこの版を使う。
- 範囲（`^12.15.0`）ではなく、決まった版を書く。範囲にすると、CI で入れる pnpm（範囲の中の最新の 12.16.0）と、
  pnpm が従うロックファイルの版（12.15.0）が食い違う（この PR の最初の CI は、`pnpm/setup` の版の確認で落ちた）。
- CI にも pnpm の版は書かない（決定 6）。版を書くのは package.json の 1 か所だけにする。
- Cloudflare の Workers Builds のビルド変数 `PNPM_VERSION` も 12 にする（README の「Workers Builds のビルド変数」）。

### 6. CI は `setup-vp` で準備し、`vp` でスクリプトを動かす

- `pnpm/setup` をやめ、Vite+ の `voidzero-dev/setup-vp` で Vite+・Node.js・pnpm を入れる。
  版は CI に書かず、Vite+ は `pnpm-workspace.yaml` の catalog（`version-file`）、Node.js は `.node-version`（`node-version-file`）、
  pnpm は `package.json` の `devEngines.packageManager` から読む。手元と CI で同じファイルを見るので、版がずれない。
- `setup-vp` は決まった版（`@v1.22.0`）で指す。Vite+ の手引きのとおり、`v1` は更新が止まっているため使わない。
- 依存は `vp install --frozen-lockfile` で入れる。`setup-vp` の中でも入れられるが（`run-install`）、どこで落ちたかをログで分かりやすくするため、別の手順にする。
- スクリプトは `vp run <スクリプト名>`、Playwright は `vp exec playwright …` で動かす。`pnpm` のコマンドが PATH に無くても動く。
  `package.json` のスクリプトは `vp run` でもキャッシュされず、環境変数もそのまま渡る（`run.cache.scripts` の既定は `false`）。
- ジョブの名前（Format・Lint・Type Check・Test・E2E）は変えない。ブランチのルールで必須にしているチェックを直さずに済むため。
- E2E のアプリは `vp preview` で起動する（`playwright.config.ts` の webServer）。
  Vite+ の `vite` には `bin/vite.js` が無いため、`node node_modules/vite-plus/bin/vp preview …` と書く。

## 採らなかった案

- **型の情報を使うリントを、最初の移行で有効にする**: ツールの入れ替えとコードの書き換えが 1 つの PR に混ざり、レビューしにくい。別の変更にした（決定 3）。
- **テストの偽物を書き換えて `unbound-method` を通す**: 偽物を窓口の型で受けず `vi.fn` の型のまま持てば通るが、9 ファイル・79 か所を書き換えても、防げる誤りが無い。
- **`typeAware` だけを有効にし、`typeCheck` は有効にしない**: 生成した型が無くても止まらずに済むが、型の分からないところで規則が黙って効かなくなり、手元と CI で結果がずれる。
- **CI を `pnpm/setup` のままにする**: 動くが、Node.js の版を CI に（`runtime: node@24`）、`.node-version` とは別に書くことになる。
- **pnpm 11 のまま、版だけを書く**: 12 で install・リント・型の検査・単体テスト・ビルド・E2E が通ったので、Vite+ が既定で選ぶ 12 にそろえた。

## 影響

- `node_modules` から `vitest`・`oxlint`・`oxfmt`・`tsx` のコマンドが無くなる。手で動かすときは `pnpm exec vp test`・`pnpm exec vp lint`・`pnpm exec vpx <ファイル>` を使う。
- 型のエラーが残っていると、コミットの前の確認（決定 4）と CI の Lint でも止まる。コミットの前の確認は 1 ファイルで約 7 秒から約 8 秒になった。

## 残っていること

- Workers Builds の `PNPM_VERSION` を、ダッシュボードで 12 に変える（決定 5）。

## 関連

- Issue #246
- [ADR-007](./007-e2e-testing.md)（E2E のアプリの起動）
- [Vite+ の移行の手引き](https://viteplus.dev/guide/migrate)
