import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema/index.js";
import { createLocalDrizzleDb } from "./lib/d1.js";
import {
  seedFacilities,
  seedGroups,
  seedMemberships,
  seedReservations,
  seedUsers,
} from "./seed/seed-data.js";

/**
 * Drizzle のクエリビルダーが生成したプレースホルダー付き SQL を
 * wrangler d1 execute 用の実行可能な SQL 文字列に変換する。
 */
function toExecutableSql({ sql, params }: { sql: string; params: unknown[] }): string {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => {
    if (paramIndex >= params.length) {
      throw new Error("SQL パラメータのプレースホルダーが不足しています。");
    }
    const val = params[paramIndex++];
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "boolean") return val ? "1" : "0";
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
    if (val instanceof Date) return String(val.getTime());
    throw new Error(`サポートされていない SQL パラメータの型です: ${typeof val}`);
  });
}

/**
 * ローカル D1 データベースへのシード実行
 */
async function seedLocal() {
  console.log("🌱 ローカル D1 データベースへのシードを開始します...");
  const { db, sqlite, dbPath } = createLocalDrizzleDb();
  console.log(`接続先 DB: ${dbPath}`);

  try {
    console.log("1/5 施設・備品データを投入中...");
    await db.insert(schema.facilityTable).values(seedFacilities).onConflictDoNothing();

    console.log("2/5 テストユーザーデータを投入中...");
    await db.insert(schema.user).values(seedUsers).onConflictDoNothing();

    console.log("3/5 団体データを投入中...");
    await db.insert(schema.groupTable).values(seedGroups).onConflictDoNothing();

    console.log("4/5 団体メンバーシップデータを投入中...");
    await db.insert(schema.membershipTable).values(seedMemberships).onConflictDoNothing();

    console.log("5/5 サンプル予約データを投入中...");
    await db.insert(schema.reservationTable).values(seedReservations).onConflictDoNothing();

    console.log("🎉 ローカル D1 データベースへのシードが正常に完了しました！");
  } finally {
    sqlite.close();
  }
}

/**
 * リモート Preview D1 データベースへのシード実行
 */
function seedRemote() {
  console.log(
    "🌱 リモート Preview D1 データベース (iclub-reserve-preview-db) へのシードを開始します...",
  );

  // Drizzle のスキーマ定義から SQL ステートメントを生成
  const inMemorySqlite = new Database(":memory:");
  const db = drizzle(inMemorySqlite, { schema });

  try {
    const statements = [
      toExecutableSql(
        db.insert(schema.facilityTable).values(seedFacilities).onConflictDoNothing().toSQL(),
      ),
      toExecutableSql(db.insert(schema.user).values(seedUsers).onConflictDoNothing().toSQL()),
      toExecutableSql(
        db.insert(schema.groupTable).values(seedGroups).onConflictDoNothing().toSQL(),
      ),
      toExecutableSql(
        db.insert(schema.membershipTable).values(seedMemberships).onConflictDoNothing().toSQL(),
      ),
      toExecutableSql(
        db.insert(schema.reservationTable).values(seedReservations).onConflictDoNothing().toSQL(),
      ),
    ];

    const sqlContent = statements.join(";\n") + ";\n";
    const tempSqlPath = path.resolve(".temp-seed.sql");
    fs.writeFileSync(tempSqlPath, sqlContent, "utf-8");

    try {
      console.log("Wrangler を実行してリモート D1 に適用しています...");
      const result = spawnSync(
        "pnpm",
        [
          "exec",
          "wrangler",
          "d1",
          "execute",
          "iclub-reserve-preview-db",
          "--remote",
          "--env",
          "preview",
          `--file=${tempSqlPath}`,
          "--yes",
        ],
        {
          stdio: "inherit",
          shell: true,
        },
      );

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        process.exit(result.status ?? 1);
      }

      console.log("🎉 リモート Preview D1 へのシードが正常に完了しました！");
    } finally {
      if (fs.existsSync(tempSqlPath)) {
        fs.unlinkSync(tempSqlPath);
      }
    }
  } finally {
    inMemorySqlite.close();
  }
}

async function main() {
  const isRemote = process.argv.includes("--remote");
  const isHelp = process.argv.includes("--help") || process.argv.includes("-h");

  if (isHelp) {
    console.log(`
使い方:
  pnpm run db:seed          # ローカル D1 にシードを実行
  pnpm run db:seed --remote # リモート Preview D1 にシードを実行
  pnpm run db:seed:preview  # （ショートカット）リモート Preview D1 にシードを実行
`);
    return;
  }

  if (isRemote) {
    seedRemote();
  } else {
    await seedLocal();
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`❌ エラー: ${error.message}`);
  } else {
    console.error("❌ 予期せぬエラーが発生しました:", error);
  }
  process.exit(1);
});
