# AI Agent Instructions for iclub-reserve

Welcome! This `AGENTS.md` file provides context and strict guidelines for AI coding assistants working on the `iclub-reserve` project.

## 1. Core AI Behavior Rules (CRITICAL)

- **Language**: Your internal thinking process can be in English, but **all code comments, commit messages, user responses, and documentation MUST be written in Japanese.**
- **Pull Requests**: Whenever you generate a Pull Request or draft its content, you **MUST** use the template provided in `.github/pull_request_template.md`.

## 2. Project Overview

`iclub-reserve` is a facility and equipment reservation system for Osaka University's Innovators' Club (i-Club). It features user authentication, reservation workflows (apply, approve, cancel), messaging, and Google Calendar integration.

- **Development Style**: Feature-based (vertical) development. Teams consist mainly of beginner developers, so code should be clear and well-documented.

## 3. Tech Stack

- **Framework**: React Router v8 (formerly Remix)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: Cloudflare D1 (SQLite) + Drizzle ORM
- **Authentication**: Better Auth
- **Infrastructure**: Cloudflare Workers (IaC managed via Terraform)
- **Package Manager**: pnpm

## 4. Development Workflow & Commands

- **Install dependencies**: `pnpm install`
- **Apply DB Migrations**: `pnpm run db:migrate:local`
- **Seed DB (Local)**: `pnpm run db:seed`
- **Seed DB (Preview)**: `pnpm run db:seed:preview`
- **Start development server**: `pnpm run dev`
- **Read a sign-in code (Local)**: `pnpm -s run dev:otp [人物の名前かメールアドレス]`（ローカルの D1 からログインの認証コードを読む。引数なしならシードの人物の一覧。手順は `local-login` スキル）
- **Run unit tests**: `pnpm test`
- **Run E2E tests**: `pnpm run test:e2e`（ビルドしてから Playwright で、パソコンの Chromium・Firefox・WebKit とスマホの Chrome・Safari の 5 種類で動かす。1 種類だけなら `pnpm exec playwright test --project=chromium`。方針は `docs/adr/007-e2e-testing.md`）。テストは `e2e/<RDRA のコンテキスト>/uc-<番号>-*.spec.ts` に置き、`@UC-<番号>` のタグを付ける。UC を `docs/implementation-status.md` で ✅ にする PR には、その UC の E2E も含める。E2E で確かめるのは主な流れ・権限の境目・UC ごとに代表的な失敗 1 つだけで、業務ルールの分岐はユースケースの単体テスト（Vitest）に書く。
- **Database**: We are using SQLite (D1), **NOT** PostgreSQL. Keep this in mind when writing Drizzle schema or migrations.

### Cloudflare environments

There are two named environments in `wrangler.jsonc`, with separate Workers **and** separate D1 databases:

| Environment  | Branch                     | Worker                  | D1                         |
| ------------ | -------------------------- | ----------------------- | -------------------------- |
| `production` | `main`                     | `iclub-reserve`         | `iclub-reserve-db`         |
| `preview`    | `develop` and its branches | `iclub-reserve-preview` | `iclub-reserve-preview-db` |

Branches of `develop` are deployed as [Worker Previews](https://developers.cloudflare.com/workers/previews/) under `iclub-reserve-preview` (`pnpm run deploy:preview-branch`, i.e. `wrangler preview --env preview`), served at `https://<branch>.iclub-preview.gdgoc-osaka.jp`. `develop` itself is served at `https://iclub-preview.gdgoc-osaka.jp`, so every preview shares the passkey rpID `iclub-preview.gdgoc-osaka.jp`. Previews do not inherit `env.preview`; their settings live in `env.preview.previews`. Queue consumers and Cron Triggers never run in a Preview, so they must stay out of that block (see `docs/adr/006-preview-environments.md`).

The top level of `wrangler.jsonc` is for local development only. It is deliberately named `iclub-reserve-local` and points at the preview D1, so that a `wrangler deploy` without `--env` cannot overwrite production.

Because `@cloudflare/vite-plugin` resolves the environment **at build time**, adding `--env` to `wrangler deploy` afterwards does _not_ switch environments — the already-built configuration wins. Always use the provided scripts (`pnpm run deploy` / `pnpm run deploy:preview`), which set `CLOUDFLARE_ENV` for the build and pass a matching `--env` to the deploy. Wrangler errors out if the two disagree.

`vars` and bindings are **not** inherited by named environments or by Previews. When adding a variable, add it to all four places (top level, `env.production`, `env.preview`, `env.preview.previews`) and keep the key sets identical — `wrangler types` runs without `--env`, so a key missing from the top level will not appear in the `Env` type.

## 5. Coding Guidelines & Constraints

- **React Router**: Keep data loaders and actions collocated with route components where possible to maintain feature-based cohesion.
- **UI Components**: Rely on `shadcn/ui` components before creating custom ones. Keep styling isolated via Tailwind utility classes.
- **Constraints**: Do not introduce unnecessary dependencies. Ensure code runs on Edge environments (Cloudflare Workers). Node.js specific APIs (`fs`, `path`, etc.) might not be available or require special handling.
- **UseCase の構造**: 本線は `safeTry(async function* () { ... })` に平らに並べ、各ステップを `yield*` で繋ぐ（`andThen` を入れ子にしない）。補助関数は接頭辞で役割を示し、複数のユースケースから使うものは `_shared/` に置く。

  | 接頭辞      | 役割                                     | 戻り値                      |
  | ----------- | ---------------------------------------- | --------------------------- |
  | `ensure*`   | 門番。通すか止めるかだけを決める         | `ResultAsync<null, E>`      |
  | `resolve*`  | 判定に使う値を組み立てる                 | `ResultAsync<T, E>`         |
  | `validate*` | 未検証の入力を検証し、正規化した値を返す | `Result<T, E>`              |
  | `find*`     | 読み取る。無ければ `null`                | `ResultAsync<T \| null, E>` |
  | `to*`       | 純粋な詰め替え・変換                     | `T`                         |

  同じ判定を 2 つのユースケースに書き写さないこと。文言だけが違うなら、`ensureNotLastAdmin` や `ensureNoApprovedOverlap` のようにメッセージを引数で受け取る。

- **画面のための読み取り**（`docs/adr/001-read-model-separation.md`・`docs/adr/012-query-functions.md`）: 更新に使わず、集約をまたいで表示するだけの読み取りは `app/query/<入口>/<出口>.ts` に置く。次の 3 つをすべて満たすもの（素通しの読み取り）は、型・門番・SQL を同じファイルに書いた関数 `find*(db, args)` 1 本にし、ポートの interface・`app/infra/` の実装・ユースケースは作らない。手本は `app/query/reservation/staff-today-schedule.ts`。判断を持つユースケースが同じ読み取りをポートで使っているとき（所属団体の一覧・団体側の未読）は、ポートの interface を残し、関数を呼ぶだけの `create<出口>Query(db)` を同じファイルに置く（ADR-012 決定 8）。

  1. 見る人の判定が、Repository を読まない門番 1 つで済む（事務局かどうかは `app/query/_shared/staff.ts` の `ensureStaff`）
  2. 見る人によって、返す形が変わらない
  3. 読むのと同時に書き込まない

  どれかを満たさない読み取り（所属で判定する・見る人によって項目を落とす など）は、今までどおりユースケースから Query ポートを通して読む。素通しの読み取りのテストは、本物の D1 を使う `<出口>-d1.test.ts`（門番が止めることも含める）と、画面に合わせて数える `to*` 関数の単体テストだけにし、偽物の Query を渡すテストは書かない。画面の部品は `app/query/` から `import type` で型だけを読み込む（値を読み込むと、DB のコードがブラウザ向けのバンドルに入る）。

- **エラーの扱い**（`docs/adr/004-error-handling-unification.md`）: ユースケースは起きたことを正直なコードで返し、利用者に何を見せるか（status・文言・存在の秘匿）は `app/routes/_shared/` のドメインごとの表が決める。見せない相手にも、ユースケースは `NotFound` に潰さず `NotVisible` を返す。

  | 書くもの                 | 置き場所                                        | 決まり                                                                   |
  | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------ |
  | エラーコードと分類       | `app/domain/<ドメイン>/`（`*ErrorKind` の表）   | 列挙子に型名を繰り返さない（`NotFound`）。ログに出る文字列の値は変えない |
  | ログ用の説明             | エラーの `message`                              | 利用者が入力した値を埋め込まない（ID は可）                              |
  | 利用者に見せる文言       | エラーの `userMessage`                          | 検証・権限の拒否では必ず書く。付け忘れると表の汎用の文言に落ちる         |
  | どの項目についての失敗か | エラーの `field`（`*Field`）                    | どの入力欄に出すかは、画面ごとの表で決める                               |
  | status と既定の文言      | `app/routes/_shared/<ドメイン>-error.server.ts` | `Partial` にせず網羅する。既定の status を破る行には理由をコメントする   |

  ルートは、loader では `throw <ドメイン>ErrorResponse(...)`、action では `return <ドメイン>ActionErrors(...)` を呼ぶだけにする。`error.code` で分岐して status や文言を自前で決めないこと。ユースケースが持っている判定（権限など）をルートに書き写して先に弾くこともしない。ログは分類に応じたレベルで必ず残るので、「ログに残さない」分岐は書けない。失敗しても画面を開く loader（ダッシュボード）だけは、`logQueryError` でログだけ残して続けてよい。

## 6. Bundled Skills

- **`rdra`** — a requirement-analysis skill based on RDRA 3.0. The skill itself lives in `.agents/skills/rdra/`; `.claude/skills/rdra` is a symlink to it so that Claude Code picks it up. Use it for requirement analysis, PRD/ADR generation, requirement review, and requirement updates. Its outputs belong in `rdra/` and `docs/`.
- **`local-login`** — ローカルの開発サーバーに、シードの利用者としてログインする手順。ブラウザで画面を確かめる途中でログインが要るときに使う。本体は `.agents/skills/local-login/`、`.claude/skills/local-login` はそこへのシンボリックリンク（`rdra` と同じ形）。アプリに開発用のログインの入口は足さず、本物の認証コードの流れを通る。ログイン画面が開いただけで出す Windows のパスキーのダイアログは、開発サーバーでだけ効く印（`app/lib/auth/dev-passkey-autofill-switch.ts`）をエージェントのブラウザに入れて止める。
