import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { copyDatabase, createSqliteReader, PAGE_SIZE, type SqlReader } from "./d1-reader.js";

let dir: string;
let sourcePath: string;
let targetPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d1-reader-"));
  sourcePath = join(dir, "source.sqlite");
  targetPath = join(dir, "target.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 写す元の SQLite を作る。room は 1 ページに収まらない行の数にし、rowid に飛びを作る */
function createSource(roomCount: number) {
  const db = new Database(sourcePath);
  db.exec(`
    CREATE TABLE room (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE session (token TEXT PRIMARY KEY, data BLOB);
    CREATE INDEX room_name ON room (name);
  `);
  const insert = db.prepare("INSERT INTO room (id, name) VALUES (?, ?)");
  db.transaction(() => {
    for (let id = 1; id <= roomCount; id++) insert.run(id, `room-${id}`);
  })();
  db.prepare("DELETE FROM room WHERE id IN (3, 4, 5)").run();
  db.prepare("INSERT INTO session (token, data) VALUES (?, ?)").run("a", Buffer.from([1, 2, 3]));
  db.close();
}

function readTarget<T>(sql: string): T[] {
  const db = new Database(targetPath, { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

describe("copyDatabase", () => {
  it("1 ページに収まらない表も、rowid に飛びのある表も、すべての行を写す", async () => {
    createSource(PAGE_SIZE * 2 + 10);
    const reader = createSqliteReader(sourcePath);
    try {
      await copyDatabase(reader, targetPath);
    } finally {
      reader.close();
    }

    const ids = readTarget<{ id: number }>("SELECT id FROM room ORDER BY id").map((r) => r.id);
    expect(ids).toHaveLength(PAGE_SIZE * 2 + 10 - 3);
    expect(ids).not.toContain(3);
    expect(ids.at(-1)).toBe(PAGE_SIZE * 2 + 10);
    expect(readTarget("SELECT token, data FROM session")).toEqual([
      { token: "a", data: Buffer.from([1, 2, 3]) },
    ]);
    // rowid の別名は、写した表の列に入れない
    expect(readTarget<{ name: string }>("PRAGMA table_info(room)").map((c) => c.name)).toEqual([
      "id",
      "name",
    ]);
    expect(
      readTarget("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"),
    ).toEqual([{ name: "room_name" }]);
  });

  it("読んでいる間に前のページの行が消えても、次のページの行を取りこぼさない", async () => {
    createSource(PAGE_SIZE * 2);
    const writer = new Database(sourcePath);
    const reader = createSqliteReader(sourcePath);
    let roomReads = 0;
    // room の 1 ページ目を読んだ直後に、その範囲の行を消す
    const deletingReader: SqlReader = {
      async all(sql, params) {
        const rows = await reader.all(sql, params);
        if (sql.includes('FROM "room"') && ++roomReads === 1) {
          writer.prepare("DELETE FROM room WHERE id IN (1, 2)").run();
        }
        return rows;
      },
    };
    try {
      await copyDatabase(deletingReader, targetPath);
    } finally {
      reader.close();
      writer.close();
    }

    const ids = readTarget<{ id: number }>("SELECT id FROM room ORDER BY id").map((r) => r.id);
    // 1 ページ目の最後の行（rowid に飛びがあるので id は PAGE_SIZE + 3）の次から読めている
    expect(ids).toContain(PAGE_SIZE + 4);
    expect(ids).toHaveLength(PAGE_SIZE * 2 - 3);
  });
});
