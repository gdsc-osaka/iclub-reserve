import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function getLocalD1DB() {
  const relativePath = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const basePath = path.resolve(relativePath);

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

  if (dbFiles.length !== 1) {
    throw new Error(
      `対象の .sqlite ファイルを一意に特定できません。\n${relativePath} ディレクトリから古い DB ファイルを削除してください:\n${dbFiles.join("\n")}`,
    );
  }

  return path.resolve(basePath, dbFiles[0]);
}

try {
  const dbPath = getLocalD1DB();
  console.log(`Starting Drizzle Studio with DB: ${dbPath}`);

  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "studio"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, LOCAL_DB_PATH: dbPath },
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
