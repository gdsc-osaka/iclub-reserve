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
- **Constraints**: Do not introduce unnecessary dependencies. Ensure code runs on Edge environments (Cloudflare Workers). Node.js specific APIs (`fs`, `path`, etc.) might not be available or require special handling.

## 6. Bundled Skills

- **`rdra`** — a requirement-analysis skill based on RDRA 3.0. The skill itself lives in `.agents/skills/rdra/`; `.claude/skills/rdra` is a symlink to it so that Claude Code picks it up. Use it for requirement analysis, PRD/ADR generation, requirement review, and requirement updates. Its outputs belong in `rdra/` and `docs/`.
