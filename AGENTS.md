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
- **Database**: We are using SQLite (D1), **NOT** PostgreSQL. Keep this in mind when writing Drizzle schema or migrations.

### Cloudflare environments

There are two named environments in `wrangler.jsonc`, with separate Workers **and** separate D1 databases:

| Environment  | Branch                     | Worker                  | D1                         |
| ------------ | -------------------------- | ----------------------- | -------------------------- |
| `production` | `main`                     | `iclub-reserve`         | `iclub-reserve-db`         |
| `preview`    | `develop` and its branches | `iclub-reserve-preview` | `iclub-reserve-preview-db` |

The top level of `wrangler.jsonc` is for local development only. It is deliberately named `iclub-reserve-local` and points at the preview D1, so that a `wrangler deploy` without `--env` cannot overwrite production.

Because `@cloudflare/vite-plugin` resolves the environment **at build time**, adding `--env` to `wrangler deploy` afterwards does _not_ switch environments — the already-built configuration wins. Always use the provided scripts (`pnpm run deploy` / `pnpm run deploy:preview`), which set `CLOUDFLARE_ENV` for the build and pass a matching `--env` to the deploy. Wrangler errors out if the two disagree.

`vars` and bindings are **not** inherited by named environments. When adding a variable, add it to all three places (top level, `env.production`, `env.preview`) and keep the key sets identical — `wrangler types` runs without `--env`, so a key missing from the top level will not appear in the `Env` type.

## 5. Coding Guidelines & Constraints

- **React Router**: Keep data loaders and actions collocated with route components where possible to maintain feature-based cohesion.
- **UI Components**: Rely on `shadcn/ui` components before creating custom ones. Keep styling isolated via Tailwind utility classes.
- **Repository と Query の使い分け**: 表示のためだけの読み取りは `app/domain/` の Repository ではなく、`app/query/` の Query ポートに書く（`docs/adr/001-read-model-separation.md`）。

  |                      | Repository                     | Query                      |
  | -------------------- | ------------------------------ | -------------------------- |
  | 返すもの             | 集約 1 件 (Entity)             | 画面 1 つ分のデータ (View) |
  | 置き場所             | `app/domain/`                  | `app/query/`               |
  | 用途                 | 更新に使う / 不変条件を守る    | 表示するだけ               |
  | JOIN                 | 集約の内側をまとめて読むなら可 | 自由 (集計・ページングも)  |
  | 結果で更新してよいか | **よい**                       | **いけない**               |

  判断基準は JOIN の有無ではなく、**取得したデータで更新するか**の 1 点。フォルダは「引数に渡す ID の集約」で決める（`groupId` を渡すなら `app/query/group/`、ID を渡さないなら返る一覧の 1 行が何かで決める）。実装は `app/infra/<集約>/*-query.ts` に置き、認可は Query ではなく usecase 層で行う。
- **Cloudflare D1**: 1 クエリごとにネットワーク往復が入るため、1 画面 1 クエリを目安にする。独立した複数クエリは `Promise.all([...])` で同時に投げること。**`db.batch([...])` は使わない** —— 結果を列名のオブジェクト経由で戻す都合上、複数テーブルの `id` や `name` を同時に選ぶと値が 1 列ずつずれて返る（エラーは出ない）。
- **Constraints**: Do not introduce unnecessary dependencies. Ensure code runs on Edge environments (Cloudflare Workers). Node.js specific APIs (`fs`, `path`, etc.) might not be available or require special handling.

## 6. Bundled Skills

- **`rdra`** — a requirement-analysis skill based on RDRA 3.0. The skill itself lives in `.agents/skills/rdra/`; `.claude/skills/rdra` is a symlink to it so that Claude Code picks it up. Use it for requirement analysis, PRD/ADR generation, requirement review, and requirement updates. Its outputs belong in `rdra/` and `docs/`.
