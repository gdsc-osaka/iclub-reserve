import { describe, expect, it } from "vite-plus/test";

import { analyzeStatement, findDeleteActions, splitStatements } from "./migration-sql.js";

describe("splitStatements", () => {
  it("Drizzle の statement-breakpoint とコメントを除いて、文に分ける", () => {
    const sql = [
      "-- 申請日時を足す。",
      "ALTER TABLE `reservation` ADD `requested_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint",
      "UPDATE `reservation` SET `requested_at` = `created_at`;",
    ].join("\n");
    expect(splitStatements(sql)).toEqual([
      "ALTER TABLE `reservation` ADD `requested_at` integer DEFAULT 0 NOT NULL",
      "UPDATE `reservation` SET `requested_at` = `created_at`",
    ]);
  });

  it("引用符の中の ; と -- は区切りにしない", () => {
    expect(
      splitStatements("INSERT INTO t VALUES ('a;b', 'it''s -- x');\n/* c; */ DELETE FROM t;"),
    ).toEqual(["INSERT INTO t VALUES ('a;b', 'it''s -- x')", "DELETE FROM t"]);
  });

  it("CREATE TRIGGER は END までを 1 つの文にする", () => {
    const sql =
      "CREATE TRIGGER tr AFTER DELETE ON a BEGIN DELETE FROM b WHERE b.a_id = old.id; END;\nSELECT 1;";
    expect(splitStatements(sql)).toEqual([
      "CREATE TRIGGER tr AFTER DELETE ON a BEGIN DELETE FROM b WHERE b.a_id = old.id; END",
      "SELECT 1",
    ]);
  });
});

describe("analyzeStatement", () => {
  it.each([
    [
      "CREATE TABLE `room` (`id` text PRIMARY KEY NOT NULL)",
      { operation: "CREATE TABLE", table: "room" },
    ],
    ['CREATE TABLE IF NOT EXISTS "a b" (x)', { operation: "CREATE TABLE", table: "a b" }],
    ["DROP TABLE IF EXISTS main.`old`", { operation: "DROP TABLE", table: "old" }],
    [
      "ALTER TABLE `__new_room` RENAME TO `room`",
      { operation: "RENAME TABLE", table: "__new_room", renamedTo: "room" },
    ],
    [
      "ALTER TABLE `user` RENAME COLUMN `mail` TO `email`",
      { operation: "RENAME COLUMN", table: "user", name: "mail", renamedTo: "email" },
    ],
    [
      "ALTER TABLE `reservation` ADD `requested_at` integer DEFAULT 0 NOT NULL",
      { operation: "ADD COLUMN", table: "reservation", name: "requested_at" },
    ],
    ["ALTER TABLE t DROP COLUMN c", { operation: "DROP COLUMN", table: "t", name: "c" }],
    [
      "CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`)",
      { operation: "CREATE INDEX", table: "user", name: "user_email_unique" },
    ],
    ["DROP INDEX IF EXISTS `idx`", { operation: "DROP INDEX", name: "idx" }],
    [
      'INSERT INTO `__new_room`("id") SELECT "id" FROM `room`',
      { operation: "INSERT", table: "__new_room" },
    ],
    ["INSERT OR IGNORE INTO t VALUES (1)", { operation: "INSERT", table: "t" }],
    ["UPDATE `reservation` SET `a` = 1", { operation: "UPDATE", table: "reservation" }],
    ["DELETE FROM `session`", { operation: "DELETE", table: "session" }],
    ["PRAGMA foreign_keys=OFF", { operation: "PRAGMA", name: "foreign_keys=OFF" }],
    [
      "CREATE TRIGGER tr AFTER UPDATE OF x ON `a` BEGIN SELECT 1; END",
      { operation: "CREATE TRIGGER", table: "a", name: "tr" },
    ],
    ["CREATE VIEW v AS SELECT 1", { operation: "CREATE VIEW", name: "v" }],
    ["WITH x AS (SELECT 1) DELETE FROM t", { operation: "UNKNOWN" }],
  ])("%s", (sql, expected) => {
    expect(analyzeStatement(sql)).toEqual({ ...expected, sql });
  });
});

describe("findDeleteActions", () => {
  it("Drizzle の FOREIGN KEY 句から、ON DELETE の動きを読む", () => {
    const sql = [
      "CREATE TABLE `reservation_read` (",
      "\t`reservation_id` text NOT NULL,",
      "\t`user_id` text NOT NULL,",
      "\tFOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON UPDATE no action ON DELETE cascade,",
      "\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action",
      ")",
    ].join("\n");
    expect(findDeleteActions(sql)).toEqual([{ parent: "reservation", action: "CASCADE" }]);
  });

  it("列に書いた REFERENCES も読む", () => {
    expect(
      findDeleteActions(
        'CREATE TABLE c (a_id TEXT REFERENCES "a"(id) ON DELETE SET NULL, b_id TEXT REFERENCES b ON DELETE CASCADE)',
      ),
    ).toEqual([
      { parent: "a", action: "SET NULL" },
      { parent: "b", action: "CASCADE" },
    ]);
  });
});
