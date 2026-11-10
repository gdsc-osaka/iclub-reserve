/**
 * 本番の D1 にまだ当てていないマイグレーションを、JSON で書き出す（ADR-017 決定 5・6）。
 * 本番への承認のジョブ（`Release Approval`）が、当てる前と当てた後に使う。
 *
 * 出力: `[{ "name": "0026_x.sql", "sha256": "..." }]`（作業ツリーのファイルの中身の SHA-256）
 *
 * 入力は環境変数で受け取る。
 *
 * - `CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_API_TOKEN`  本番の D1 を読むためのもの
 * - `D1_DATABASE_NAME`  読む D1 の名前（既定は本番の `iclub-reserve-db`）
 * - `UNAPPLIED_OUTPUT`  JSON を書くファイル（省くと標準出力に出す）
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCloudflareReader, readAppliedMigrations } from "./d1-reader.js";

const MIGRATIONS_DIR = "drizzle/migrations";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) {
  console.error("CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が要ります。");
  process.exit(1);
}

const reader = await createCloudflareReader({
  accountId,
  token,
  databaseName: process.env.D1_DATABASE_NAME || "iclub-reserve-db",
});
const applied = new Set(await readAppliedMigrations(reader));

const unapplied = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql") && !applied.has(name))
  .sort()
  .map((name) => ({
    name,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"))
      .digest("hex"),
  }));

const output = process.env.UNAPPLIED_OUTPUT;
if (output) {
  fs.writeFileSync(output, JSON.stringify(unapplied));
  console.log(`未適用: ${unapplied.map((m) => m.name).join(", ") || "なし"}`);
} else {
  console.log(JSON.stringify(unapplied));
}
