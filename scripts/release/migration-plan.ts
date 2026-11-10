/**
 * PR のマイグレーションの概要を作る（ADR-017 決定 6・8）。`pnpm run release:migration-plan` で動かす。
 *
 * 1. ベースのブランチと比べて、足した・書き換えた・消したマイグレーションのファイルを調べる
 * 2. 相手の D1 で、どれが当たっているかを読む（`main` 向きなら本番、`develop` 向きなら preview）
 * 3. 相手の D1 を SELECT で読んでローカルの D1 に写し、未適用のものを当てる（予行演習）
 * 4. コメントの Markdown を `PLAN_OUTPUT` に書き、チェックを落とす理由があれば終了コード 1 で終わる
 *
 * 入力は環境変数で受け取る。
 *
 * - `PLAN_TARGET`               `production` か `preview`
 * - `BASE_SHA`・`HEAD_SHA`      比べる 2 つのコミット（`HEAD_SHA` を省くと `HEAD`）
 * - `CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_D1_READ_TOKEN`  相手の D1 を読むためのもの（D1 Read で足りる）
 * - `PLAN_SOURCE_SQLITE`        相手の D1 の代わりに読む SQLite のファイル（手元で試すとき）
 * - `APPLIED_RECORDS`           本番への承認で当てたときの記録（JSON の配列）のファイル
 * - `PLAN_OUTPUT`               Markdown を書くファイル（既定は `migration-plan.md`）
 * - `GITHUB_REPOSITORY`         SQL のファイルへのリンクに使う
 *
 * 手元で試すときは、マイグレーションをコミットしてから動かす（作業ツリーのファイルを当て、一覧は git から読むため）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLocalD1DBPath } from "../lib/d1.js";
import {
  copyDatabase,
  countRows,
  createCloudflareReader,
  createSqliteReader,
  readAppliedMigrations,
  readSchema,
  type SqlReader,
} from "./d1-reader.js";
import {
  buildEmptyPlan,
  buildPlan,
  stripAnsi,
  type DryRun,
  type MigrationFile,
  type PlanTarget,
} from "./migration-plan-core.js";

/** 環境ごとの D1 の名前（`wrangler.jsonc` の `env.<環境>.d1_databases`） */
const DATABASE_NAME: Record<PlanTarget, string> = {
  production: "iclub-reserve-db",
  preview: "iclub-reserve-preview-db",
};

const MIGRATIONS_DIR = "drizzle/migrations";

const env = (name: string): string | undefined => process.env[name] || undefined;

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

const listMigrations = (sha: string): string[] =>
  git("ls-tree", "--name-only", `${sha}:${MIGRATIONS_DIR}`)
    .split("\n")
    .filter((name) => name.endsWith(".sql"))
    .sort();

const readMigration = (sha: string, name: string): string =>
  git("show", `${sha}:${MIGRATIONS_DIR}/${name}`);

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** ベースと比べて、この PR で足した・書き換えた・消したマイグレーションのファイル */
function diffMigrations(base: string, head: string) {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const lines = git(
    "diff",
    "--name-status",
    "--no-renames",
    `${base}...${head}`,
    "--",
    MIGRATIONS_DIR,
  )
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    const [status, file] = line.split("\t");
    if (path.posix.dirname(file) !== MIGRATIONS_DIR || !file.endsWith(".sql")) continue;
    const name = path.posix.basename(file);
    if (status === "A") added.push(name);
    else if (status === "D") deleted.push(name);
    else modified.push(name);
  }
  return { added, modified, deleted };
}

/** 本番への承認で当てたときの記録（ファイル名 → 中身の SHA-256）。後の記録で上書きする */
function readAppliedRecords(file: string | undefined): Map<string, string> {
  const records = new Map<string, string>();
  if (!file || !fs.existsSync(file)) return records;
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as { files?: Record<string, string> }[];
  for (const record of list) {
    for (const [name, hash] of Object.entries(record.files ?? {})) records.set(name, hash);
  }
  return records;
}

/** wrangler を動かす。ローカルの D1 だけを触るので、Cloudflare のトークンは渡さない */
function wrangler(args: string[]) {
  const childEnv = { ...process.env };
  delete childEnv.CLOUDFLARE_API_TOKEN;
  delete childEnv.CLOUDFLARE_D1_READ_TOKEN;
  const result = spawnSync(
    process.execPath,
    [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
    { encoding: "utf8", env: { ...childEnv, WRANGLER_SEND_METRICS: "false" } },
  );
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * 相手の D1 の写しに、未適用のマイグレーションを当てる。
 * 写しはランナーの一時フォルダに置き、終わったら消す（artifact には上げない）。
 */
async function runDryRun(
  reader: SqlReader,
  target: PlanTarget,
  unapplied: readonly MigrationFile[],
): Promise<DryRun> {
  const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), "migration-plan-"));
  const local = ["--local", "--env", target, "--persist-to", persistTo];
  try {
    // wrangler に空のローカルの D1 を作らせてから、そのファイルに写す
    const created = wrangler([
      "d1",
      "execute",
      DATABASE_NAME[target],
      ...local,
      "--command",
      "SELECT 1",
    ]);
    if (!created.ok) return { ok: false, message: created.output };

    const dbPath = getLocalD1DBPath(persistTo);
    try {
      await copyDatabase(reader, dbPath);
    } catch {
      // 写すときのエラーには行の中身が混じることがあるので、文は出さない
      return { ok: false, message: "相手の D1 をローカルの D1 に写せませんでした。" };
    }
    const before = countRows(dbPath);

    const applied = wrangler(["d1", "migrations", "apply", DATABASE_NAME[target], ...local]);
    if (!applied.ok) {
      // wrangler は 1 つずつ当てて記録するので、記録の無い最初のものが落ちたファイル
      const localReader = createSqliteReader(dbPath);
      const done = new Set(await readAppliedMigrations(localReader));
      localReader.close();
      const failedFile = unapplied.find((file) => !done.has(file.name))?.name;
      // wrangler の見出しや一時フォルダの場所は要らないので、エラーの行だけを出す
      const errorLines = stripAnsi(applied.output)
        .split("\n")
        .filter((line) => line.includes("[ERROR]"))
        .map((line) => line.replace(/^.*?\[ERROR\]\s*/, ""));
      return {
        ok: false,
        failedFile,
        message: errorLines.length > 0 ? errorLines.join("\n") : applied.output,
      };
    }
    return { ok: true, before, after: countRows(dbPath) };
  } finally {
    fs.rmSync(persistTo, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const target = env("PLAN_TARGET");
  if (target !== "production" && target !== "preview") {
    console.log("::error::PLAN_TARGET は production か preview にしてください。");
    return 1;
  }
  const base = env("BASE_SHA");
  if (!base) {
    console.log("::error::BASE_SHA がありません。");
    return 1;
  }
  const head = git("rev-parse", env("HEAD_SHA") ?? "HEAD").trim();
  const output = env("PLAN_OUTPUT") ?? "migration-plan.md";
  const databaseName = DATABASE_NAME[target];

  const { added, modified, deleted } = diffMigrations(base, head);
  // 本番は、PR がマイグレーションを足していなくても読む（main に未適用のものが残っていないかも見る）。
  // preview は、足していない PR では Cloudflare に触れない（Dependabot やフォークの PR には secret が渡らない）
  const needsDatabase = target === "production" || added.length > 0;

  const writeOutputs = (markdown: string, hasPlan: boolean) => {
    fs.writeFileSync(output, markdown);
    const githubOutput = env("GITHUB_OUTPUT");
    if (githubOutput) fs.appendFileSync(githubOutput, `has_plan=${hasPlan}\n`);
  };

  if (!needsDatabase && modified.length === 0 && deleted.length === 0) {
    console.log("この PR はマイグレーションを足していません。");
    writeOutputs(buildEmptyPlan(), false);
    return 0;
  }

  let reader: (SqlReader & { close?: () => void }) | undefined;
  const sourceSqlite = env("PLAN_SOURCE_SQLITE");
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_D1_READ_TOKEN");
  if (!needsDatabase) {
    reader = undefined;
  } else if (sourceSqlite) {
    reader = createSqliteReader(sourceSqlite);
  } else if (accountId && token) {
    reader = await createCloudflareReader({ accountId, token, databaseName });
  }

  const headFiles = listMigrations(head);
  let unapplied: MigrationFile[] = [];
  let appliedNotInHead: string[] = [];
  const appliedChanged: string[] = [];
  const appliedUnrecorded: string[] = [];
  let schemaBefore = new Map<string, string>();
  let dryRun: DryRun | undefined;

  try {
    if (reader) {
      const applied = new Set(await readAppliedMigrations(reader));
      unapplied = headFiles
        .filter((name) => !applied.has(name))
        .map((name) => ({ name, sql: readMigration(head, name) }));
      appliedNotInHead = [...applied].filter((name) => !headFiles.includes(name));

      // この PR で足したのに、もう当たっているもの。本番への承認で当てた後に書き換えていないかを見る
      const records = readAppliedRecords(env("APPLIED_RECORDS"));
      for (const name of added.filter((n) => applied.has(n))) {
        const recorded = records.get(name);
        if (!recorded) appliedUnrecorded.push(name);
        else if (recorded !== sha256(readMigration(head, name))) appliedChanged.push(name);
      }

      schemaBefore = new Map(
        (await readSchema(reader)).filter((o) => o.type === "table").map((o) => [o.name, o.sql]),
      );
      if (unapplied.length > 0) dryRun = await runDryRun(reader, target, unapplied);
    }
  } finally {
    reader?.close?.();
  }

  const plan = buildPlan({
    target,
    databaseName,
    repository: env("GITHUB_REPOSITORY") ?? "gdsc-osaka/iclub-reserve",
    headSha: head,
    modified,
    deleted,
    unapplied,
    appliedNotInHead,
    appliedChanged,
    appliedUnrecorded,
    schemaBefore,
    dryRun,
    credentialsMissing: needsDatabase && !reader,
  });
  writeOutputs(plan.markdown, true);

  // ログに出すのはファイルの名前と判定だけにする（行数と行の中身は出さない）
  console.log(`未適用: ${unapplied.map((f) => f.name).join(", ") || "なし"}`);
  if (dryRun) console.log(`予行演習: ${dryRun.ok ? "成功" : "失敗"}`);
  for (const warning of plan.warnings) console.log(`::warning::${warning}`);
  for (const error of plan.errors) console.log(`::error::${error}`);
  return plan.errors.length > 0 ? 1 : 0;
}

process.exitCode = await main();
