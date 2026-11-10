/**
 * 相手の D1 を SELECT だけで読む（ADR-017 決定 8）。
 *
 * D1 の書き出し（`wrangler d1 export`）は D1 Read のトークンでは使えず、D1 Edit が要る。
 * Migration Plan は本番への承認の前に PR のワークフローで動くので、書き込めるトークンは渡したくない。
 * そこで、表の定義と行を SELECT で読み、ランナーのローカルの D1 に組み立て直す。
 * 書き出しと違い、読んでいる間も相手の D1 は止まらない。
 *
 * 読んだ行はログにも出力にも出さない（公開リポジトリのため）。
 */
import Database from "better-sqlite3";

export type Row = Record<string, unknown>;

export interface SqlReader {
  all(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

interface CloudflareResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

/** Cloudflare の API で D1 を読む。トークンは D1 Read があれば足りる */
export async function createCloudflareReader(options: {
  accountId: string;
  token: string;
  databaseName: string;
}): Promise<SqlReader> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
  };

  const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, headers });
    const body = (await response.json()) as CloudflareResponse<T>;
    if (!response.ok || !body.success) {
      // エラーの文は SQLite と API のもので、行の中身は含まない
      const messages = body.errors.map((e) => `${e.code}: ${e.message}`).join(" / ");
      throw new Error(`D1 の API が失敗しました（HTTP ${response.status}）: ${messages}`);
    }
    return body.result;
  };

  const databases = await request<{ uuid: string; name: string }[]>(
    `${base}?name=${encodeURIComponent(options.databaseName)}`,
  );
  const database = databases.find((d) => d.name === options.databaseName);
  if (!database) throw new Error(`D1 の ${options.databaseName} が見つかりません。`);

  return {
    async all(sql, params = []) {
      const [result] = await request<{ results: Row[] }[]>(`${base}/${database.uuid}/query`, {
        method: "POST",
        body: JSON.stringify({ sql, params }),
      });
      return result?.results ?? [];
    },
  };
}

/** ローカルの SQLite のファイルを読む。手元で Migration Plan を試すときに使う */
export function createSqliteReader(path: string): SqlReader & { close(): void } {
  const db = new Database(path, { readonly: true });
  return {
    all: async (sql, params = []) => db.prepare(sql).all(...params) as Row[],
    close: () => db.close(),
  };
}

/** 識別子を `"..."` で囲む */
export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** D1 が内部で使う表と、SQLite が自分で持つ表。写さず、行数も比べない */
export const isInternalTable = (name: string) =>
  name.startsWith("sqlite_") || name.startsWith("_cf_");

export interface SchemaObject {
  type: "table" | "index" | "trigger" | "view";
  name: string;
  sql: string;
}

/** 表・索引・トリガー・ビューの定義を、作った順に読む */
export async function readSchema(reader: SqlReader): Promise<SchemaObject[]> {
  const rows = await reader.all(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
  );
  return (rows as unknown as SchemaObject[]).filter((o) => !isInternalTable(o.name));
}

/** 適用済みのマイグレーションの名前。wrangler は `d1_migrations` の表に記録する */
export async function readAppliedMigrations(reader: SqlReader): Promise<string[]> {
  const tables = await reader.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
  );
  if (tables.length === 0) return [];
  const rows = await reader.all("SELECT name FROM d1_migrations ORDER BY id");
  return rows.map((r) => String(r.name));
}

/** 1 回に読む行の数。D1 の 1 回の応答が大きくなりすぎないようにする */
const PAGE_SIZE = 500;

/** API の JSON の値を、SQLite に入れる値に直す。整数は BigInt にして INTEGER のまま入れる */
function toSqliteValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (Array.isArray(value)) return Buffer.from(value as number[]);
  return value;
}

/**
 * 相手の D1 の定義と行を、空の SQLite のファイルに写す。
 * 表を作って行を入れてから、索引・トリガー・ビューを作る（行を入れるときにトリガーを動かさないため）。
 */
export async function copyDatabase(reader: SqlReader, targetPath: string): Promise<void> {
  const schema = await readSchema(reader);
  const db = new Database(targetPath);
  try {
    // 行を入れる順で、外部キーの確認に引っかからないようにする
    db.pragma("foreign_keys = OFF");
    db.exec("BEGIN");

    for (const table of schema.filter((o) => o.type === "table")) {
      db.exec(table.sql);
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const rows = await reader.all(
          `SELECT * FROM ${quoteIdent(table.name)} ORDER BY rowid LIMIT ? OFFSET ?`,
          [PAGE_SIZE, offset],
        );
        if (rows.length === 0) break;
        const columns = Object.keys(rows[0]);
        const insert = db.prepare(
          `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        );
        for (const row of rows) insert.run(...columns.map((c) => toSqliteValue(row[c])));
        if (rows.length < PAGE_SIZE) break;
      }
    }

    for (const object of schema.filter((o) => o.type !== "table")) {
      db.exec(object.sql);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

/** 表ごとの行数（内部の表と `d1_migrations` は除く） */
export function countRows(path: string): Map<string, number> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    const counts = new Map<string, number>();
    for (const { name } of tables) {
      if (isInternalTable(name) || name === "d1_migrations") continue;
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`).get() as {
        n: number;
      };
      counts.set(name, row.n);
    }
    return counts;
  } finally {
    db.close();
  }
}
