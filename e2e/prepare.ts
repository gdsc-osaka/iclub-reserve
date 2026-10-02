/**
 * E2E テストでアプリを起動する前の準備。
 *
 * `playwright.config.ts` の webServer が、`vite preview` を起動する直前に実行する。
 * テストのたびに同じ状態から始められるよう、次の 2 つを行う。
 *
 * 1. ビルド済みのアプリ（`build/server/`）に、E2E 用の設定（`.dev.vars`）を置く
 * 2. E2E 用の DB を消して作り直し、マイグレーションとシードを入れる
 *
 * 単体で動かすときは `pnpm exec tsx e2e/prepare.ts`。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createLocalDrizzleDb } from "../scripts/lib/d1.js";
import { insertSeedData } from "../scripts/seed/insert-seed-data.js";
import { E2E_AUTH_SECRET, E2E_BASE_URL, E2E_PERSIST_TO } from "./support/e2e-env.js";

/** `react-router build` が Worker を書き出すフォルダ */
const BUILD_SERVER_DIR = "build/server";

/**
 * ビルド済みのアプリに E2E 用の `.dev.vars` を置く。
 *
 * `vite preview` は、ビルドのときに `.dev.vars` を写した `build/server/.dev.vars` を読む。
 * ここを E2E 用の値で上書きしておくと、手元の `.dev.vars` に何が書いてあっても
 * E2E は同じ設定で動く。とくに SMTP の認証情報を空にすることで、
 * テスト中のメールが実際に送られることはなく、ターミナルに出るだけになる。
 */
function writeDevVars(): void {
  if (!fs.existsSync(path.join(BUILD_SERVER_DIR, "wrangler.json"))) {
    throw new Error(
      "ビルド済みのアプリが見つかりません。先に `pnpm run build` を実行してください（`pnpm run test:e2e` なら自動で行います）。",
    );
  }

  const devVars = [
    `BETTER_AUTH_SECRET="${E2E_AUTH_SECRET}"`,
    `BETTER_AUTH_URL="${E2E_BASE_URL}"`,
    'SMTP_USER=""',
    'SMTP_PASSWORD=""',
  ].join("\n");

  fs.writeFileSync(path.join(BUILD_SERVER_DIR, ".dev.vars"), `${devVars}\n`, "utf-8");
}

/** E2E 用の DB を消して作り直し、マイグレーションを当ててシードを入れる */
async function resetDatabase(): Promise<void> {
  fs.rmSync(E2E_PERSIST_TO, { recursive: true, force: true });

  // `pnpm run db:migrate:local` と同じコマンドを、E2E 用のフォルダに向けて実行する
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "iclub-reserve-preview-db",
      "--local",
      "--persist-to",
      E2E_PERSIST_TO,
    ],
    { stdio: "inherit", shell: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`マイグレーションの適用に失敗しました（終了コード ${result.status}）。`);
  }

  const { db, sqlite } = createLocalDrizzleDb(E2E_PERSIST_TO);
  try {
    await insertSeedData(db);
  } finally {
    sqlite.close();
  }
}

try {
  writeDevVars();
  await resetDatabase();
  console.log("E2E の準備ができました。");
} catch (error) {
  console.error(error instanceof Error ? `❌ ${error.message}` : error);
  process.exit(1);
}
