import { defineConfig } from "drizzle-kit";
import fs from "node:fs";
import path from "node:path";

// Drizzle Studio 用に、ローカルの SQLite ファイルパスを自動探索する関数
// 非公式の実装のため、wrangler や Drizzle Studio の将来のバージョンで動作しなくなる可能性あり
function getLocalD1DB() {
  const basePath = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

  if (!fs.existsSync(basePath)) {
    throw new Error("ローカル DB が見つかりません。先に `pnpm run dev` を実行してください。");
  }

  // .sqlite で終わるファイルのうち、'metadata.sqlite' を除外する
  const dbFiles = fs
    .readdirSync(basePath)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");

  if (dbFiles.length === 0) {
    throw new Error("対象の .sqlite ファイルが見つかりません。");
  }

  return path.resolve(basePath, dbFiles[0]);
}

export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./app/db/schema.ts",
  dialect: "sqlite",

  dbCredentials: {
    url: getLocalD1DB(),
  },
});
