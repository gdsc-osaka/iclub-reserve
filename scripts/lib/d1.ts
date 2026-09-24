import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../app/db/schema/index.js";

export interface LocalDrizzleDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  dbPath: string;
}

/**
 * ローカルの状態（D1・R2 など）を置く既定のフォルダ。
 * `wrangler dev` や `pnpm run dev` が何も指定しないときに使う場所と同じ。
 */
export const DEFAULT_PERSIST_TO = ".wrangler/state";

/**
 * Wrangler (Miniflare) が生成したローカル D1 の SQLite ファイルの絶対パスを取得する。
 *
 * @param persistTo 状態を置くフォルダ。wrangler の `--persist-to` に渡すのと同じ値を渡す。
 *   E2E テストは開発用の DB を壊さないよう、別のフォルダ（`e2e/support/e2e-env.ts` の `E2E_PERSIST_TO`）を使う。
 */
export function getLocalD1DBPath(persistTo: string = DEFAULT_PERSIST_TO): string {
  // wrangler も Vite のプラグインも、指定したフォルダの下に `v3` を足してから置く
  const basePath = path.resolve(persistTo, "v3/d1/miniflare-D1DatabaseObject");

  if (!fs.existsSync(basePath)) {
    throw new Error(
      "ローカル DB が見つかりません。先に `pnpm run db:migrate:local` または `pnpm run dev` を実行してください。",
    );
  }

  // .sqlite で終わるファイルのうち、'metadata.sqlite' を除外する
  const dbFiles = fs
    .readdirSync(basePath)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");

  if (dbFiles.length === 0) {
    throw new Error(
      "対象の .sqlite ファイルが見つかりません。先に `pnpm run db:migrate:local` を実行してください。",
    );
  }

  if (dbFiles.length === 1) {
    return path.resolve(basePath, dbFiles[0]);
  }

  // 複数の .sqlite ファイルが存在する場合、テーブルを持つ有効な DB を優先して特定する
  const filesWithTables = dbFiles.filter((file) => {
    try {
      const db = new Database(path.resolve(basePath, file), { readonly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      db.close();
      return tables.length > 0;
    } catch {
      return false;
    }
  });

  if (filesWithTables.length === 1) {
    return path.resolve(basePath, filesWithTables[0]);
  }

  const candidateFiles = filesWithTables.length > 0 ? filesWithTables : dbFiles;

  // 更新日時が最も新しいファイルを選択
  candidateFiles.sort((a, b) => {
    const statA = fs.statSync(path.resolve(basePath, a));
    const statB = fs.statSync(path.resolve(basePath, b));
    return statB.mtimeMs - statA.mtimeMs;
  });

  return path.resolve(basePath, candidateFiles[0]);
}

/**
 * ローカルの SQLite ファイルを開き、Drizzle インスタンスを生成して返す。
 *
 * @param persistTo 状態を置くフォルダ。詳しくは `getLocalD1DBPath` を参照。
 */
export function createLocalDrizzleDb(persistTo: string = DEFAULT_PERSIST_TO): LocalDrizzleDb {
  const dbPath = getLocalD1DBPath(persistTo);
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  return { db, sqlite, dbPath };
}
