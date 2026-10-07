/**
 * テストから、ローカルの本物の D1 を使うための補助。
 *
 * 【なぜ本物の D1 を使うのか】
 * 本番の書き込みは `db.batch()` で業務データと outbox などを不可分に書く（ADR-002 決定 3）。
 * better-sqlite3 版の Drizzle には `batch` が無いため、そちらでは本番と同じ道を通せない。
 * wrangler の `getPlatformProxy` で Miniflare のローカル D1 を取り、本番と同じ `drizzle-orm/d1` を通して確かめる。
 * `batch` の代わりを自作しないのは、その代わりが本物と食い違っても誰も気付けないため。
 *
 * 【使い方】
 * テストファイルの先頭（describe の外）で `useD1TestDb()` を 1 回呼ぶ。
 * ファイルごとに D1 を 1 つ起動し、テストごとにすべての表を空にする。前提データは各テストで入れる。
 *
 * ```ts
 * const testDb = useD1TestDb();
 *
 * it("...", async () => {
 *   await testDb.seed([`INSERT INTO "group" (...) VALUES (?,?)`, "grp_1", "ロボット部"]);
 *   const repository = createReservationRepository(testDb.db);
 * });
 * ```
 *
 * 【かかる時間の目安】（Windows のローカルで測った値）
 * 起動に約 0.5 秒、マイグレーションに約 1.7 秒。ローカルの D1 は、値を当てはめる文（prepare）を
 * 1 つ流すごとに 40〜80 ミリ秒かかる。前提データの投入と表の初期化は、その道を通らない `exec` で流しているので
 * 数ミリ秒で済む（`seed`・`reset`）。前提データは `seed` を何度も呼ばず、1 回にまとめて渡すこと。
 *
 * テストからだけ使う。アプリのコードから import しないこと（wrangler をバンドルに巻き込む）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { getPlatformProxy } from "wrangler";

import { createDb, type Database } from "./db";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

/** 生の SQL 1 文と、`?` に当てはめる値 */
export type SeedStatement = readonly [sql: string, ...params: unknown[]];

/** 起動したテスト用の D1 */
export interface D1TestDb {
  /** 本番と同じ作り方の Drizzle クライアント。Repository や Query に渡す */
  readonly db: Database;
  /** D1 のバインディングそのもの。前提データを入れたり、書かれた行を生の値で読み戻したりするのに使う */
  readonly d1: D1Database;
  /**
   * 前提データを入れる。生の SQL を、渡した順に 1 回で流す。どれかが失敗すれば例外を投げる。
   *
   * 値は SQL に埋め込んでから流す（`toSqlLiteral` を参照）。日時は `getTime()` でミリ秒に直して渡すこと。
   */
  seed(...statements: readonly SeedStatement[]): Promise<void>;
  /** すべての表を空にする。表の定義はそのまま残す */
  reset(): Promise<void>;
  /** D1 を動かしているプロセスを止める */
  dispose(): Promise<void>;
}

/**
 * マイグレーションの文を、ファイル名の順に並べて返す。
 *
 * スキーマをテスト用に書き写すと、本物との食い違いに気付けない。
 * `drizzle/migrations/` をそのまま流し、本番と同じ形の上で確かめる。
 */
const readMigrationStatements = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS_DIR, file), "utf8")
        // drizzle-kit は文の区切りにこの印を入れる
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ""),
    );

/**
 * 前提データの値 1 つを、SQL にそのまま書ける形にする。
 *
 * `seed` は速さのために `exec` で流すが、`exec` は値の当てはめ（bind）を受け付けないので、値を SQL に埋め込む。
 * 渡すのはテストが自分で決めた値だけなので、外から来た値を埋め込む危うさは無い。それでも文字列は必ず引用符で囲み、
 * 中の `'` は二重にする。`exec` は改行で文を区切るため、文字列の中の改行は `char()` で書いて行を分けない。
 * 型を取り違えたまま入るのを防ぐため、扱えない値（日時・undefined・オブジェクト）は例外にする。
 */
const toSqlLiteral = (value: unknown): string => {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`seed に有限でない数を渡した: ${value}`);
    return String(value);
  }
  if (typeof value === "string") {
    const quoted = `'${value.replaceAll("'", "''")}'`;
    return quoted.replaceAll("\r", "' || char(13) || '").replaceAll("\n", "' || char(10) || '");
  }
  throw new TypeError(
    `seed に渡せない値を渡した（${value instanceof Date ? "Date。getTime() で数にすること" : typeof value}）`,
  );
};

/**
 * SQL の `?` に、値を順に埋め込む。`?` と値の数が合わなければ例外にする。
 *
 * SQL の中の `?` はすべて当てはめる場所と見なすので、文字列リテラルの中に `?` を書かないこと。
 * SQL の途中の改行は空白に置き換え、1 文を 1 行にする（`exec` は改行で文を区切るため）。
 */
const inlineParams = (sql: string, params: readonly unknown[]): string => {
  let index = 0;
  const inlined = sql.replace(/\?/g, () => {
    if (index >= params.length) {
      throw new TypeError(`seed の値が足りない（? が ${index + 1} 個目で尽きた）: ${sql}`);
    }
    return toSqlLiteral(params[index++]);
  });
  if (index !== params.length) {
    throw new TypeError(
      `seed の値が多すぎる（? は ${index} 個、値は ${params.length} 個）: ${sql}`,
    );
  }
  return inlined.replace(/\s*\r?\n\s*/g, " ");
};

/**
 * すべての表を空にする SQL を組む。
 *
 * テストごとに流すので速さが要る。表ごとの DELETE を batch で流すと 1 文ごとに時間がかかる（16 表で約 0.25 秒）ため、
 * `exec` で 1 回に流す（約 0.01 秒）。`exec` はトランザクションにならず外部キーを文ごとに確かめるので、
 * 参照する側（子）の表を、参照される側（親）の表より先に消す順に並べる。
 * 表の間で参照が輪になると順番を決められないが、そのときは exec が外部キー違反で失敗するので気付ける。
 */
const buildResetSql = async (d1: D1Database): Promise<string> => {
  const { results: tables } = await d1
    .prepare(
      // sqlite_* は SQLite の、_cf_* は D1 の内部の表なので触らない
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
    )
    .all<{ name: string }>();

  const references = await d1.batch<{ parent: string }>(
    tables.map(({ name }) =>
      d1.prepare(`SELECT "table" AS parent FROM pragma_foreign_key_list(?)`).bind(name),
    ),
  );

  /** 親の表の名前 → それを参照している子の表の名前 */
  const childrenOf = new Map<string, string[]>();
  tables.forEach(({ name: child }, index) => {
    for (const { parent } of references[index]?.results ?? []) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    }
  });

  // 子を先に並べてから自分を並べる（深さ優先）。同じ表を 2 度並べないよう、訪れた表を覚えておく
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const child of childrenOf.get(name) ?? []) visit(child);
    order.push(name);
  };
  for (const { name } of tables) visit(name);

  // exec は改行で文を区切るので、1 行に 1 文ずつ置く
  return order.map((name) => `DELETE FROM "${name}";`).join("\n");
};

/**
 * テスト用の D1 を起動し、マイグレーションを流した状態で返す。
 *
 * 普段は `useD1TestDb` を使う。こちらは起動と後始末を自分で書きたいときのためのもの。
 */
export const createD1TestDb = async (): Promise<D1TestDb> => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(process.cwd(), "wrangler.jsonc"),
    // ファイルに残さない。テストファイルごとに空の別の DB になり、並列に流しても衝突しない
    persist: false,
    // Cloudflare のアカウントにつながず、手元だけで完結させる
    remoteBindings: false,
    // .env の秘密の値は要らないので読まない
    envFiles: [],
  });
  const d1 = proxy.env.DB;

  // 1 文ずつ流すと往復のぶん遅い（約 4.7 秒）ので、1 回の batch にまとめる（約 1.7 秒）
  await d1.batch(readMigrationStatements().map((statement) => d1.prepare(statement)));

  // 空にする SQL は、マイグレーションの後に 1 度だけ組んでおく
  const resetSql = await buildResetSql(d1);

  const seed = async (...statements: readonly SeedStatement[]): Promise<void> => {
    if (statements.length === 0) return;
    await d1.exec(statements.map(([sql, ...params]) => inlineParams(sql, params)).join("\n"));
  };

  const reset = async (): Promise<void> => {
    await d1.exec(resetSql);
  };

  return {
    db: createDb(d1),
    d1,
    seed,
    reset,
    dispose: () => proxy.dispose(),
  };
};

/**
 * テストファイルの中で、テスト用の D1 を使えるようにする。
 *
 * ファイルの最初のテストの前に起動し、テストごとにすべての表を空にし、最後に止める。
 * 返り値の各項目は、起動した後（テストや beforeEach の中）でだけ使える。
 */
export const useD1TestDb = (): Omit<D1TestDb, "dispose"> => {
  let current: D1TestDb | undefined;

  // 起動とマイグレーションで数秒かかり、CI でほかのファイルと並んで動くとさらに延びるので、既定の 10 秒より長く待つ
  beforeAll(async () => {
    current = await createD1TestDb();
  }, 60_000);

  afterAll(async () => {
    await current?.dispose();
  });

  beforeEach(async () => {
    await current?.reset();
  });

  const started = (): D1TestDb => {
    if (current === undefined) {
      throw new Error("テスト用の D1 がまだ起動していない。テストか beforeEach の中で使うこと。");
    }
    return current;
  };

  return {
    get db() {
      return started().db;
    },
    get d1() {
      return started().d1;
    },
    seed: (...statements) => started().seed(...statements),
    reset: () => started().reset(),
  };
};
