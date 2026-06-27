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
- **Start development server**: `pnpm run dev`
- **Database**: We are using SQLite (D1), **NOT** PostgreSQL. Keep this in mind when writing Drizzle schema or migrations.

## 5. Coding Guidelines & Constraints

- **React Router**: Keep data loaders and actions collocated with route components where possible to maintain feature-based cohesion.
- **UI Components**: Rely on `shadcn/ui` components before creating custom ones. Keep styling isolated via Tailwind utility classes.
- **Constraints**: Do not introduce unnecessary dependencies. Ensure code runs on Edge environments (Cloudflare Workers). Node.js specific APIs (`fs`, `path`, etc.) might not be available or require special handling.
