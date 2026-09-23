/**
 * 団体一覧（SCR-008）の読み取りと、団体の状態の更新（UC-014）を、本物の SQLite に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Query と Repository を偽物に差し替えるので、SQL の誤りは素通りする。
 * 実際に、最初の実装ではメンバー数を相関サブクエリで数えており、Drizzle が列名から表名を省いたせいで
 * 内側の `id` が group_member.id を指し、どの団体も「メンバー 0 人」になっていた。
 * 型もテストも通っていたので、ここで数と並び順を実際の DB で押さえる。
 *
 * マイグレーションをそのまま流す理由は `invitation-accept-sqlite.test.ts` と同じ。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { Database } from "../db";
import { createUserGroupListQuery } from "../user/user-group-list-query";
import { createGroupRepository } from "./group-repo";
import { createGroupSearchQuery } from "./group-search-query";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

/** マイグレーションを流し、団体とメンバーを入れた DB を作る */
const createDatabase = () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit は文の区切りにこの印を入れる
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") sqlite.exec(statement.trim());
    }
  }

  const insertUser = sqlite.prepare(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
  );
  insertUser.run("usr_taro", "太郎", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0);
  insertUser.run("usr_hanako", "花子", "hanako@ecs.osaka-u.ac.jp", 1, 0, 0, 0);
  insertUser.run("usr_jiro", "次郎", "jiro@ecs.osaka-u.ac.jp", 1, 0, 0, 0);

  const insertGroup = sqlite.prepare(
    `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
  );
  // 名前の順と作成日時の順をわざと食い違わせ、並び順の切り替えが確かめられるようにしている
  insertGroup.run("grp_robotics", "ロボット部", "enabled", 1_000, 1_000);
  insertGroup.run("grp_ai", "AI 研究会", "pending", 3_000, 3_000);
  insertGroup.run("grp_band", "軽音部", "pending", 2_000, 2_000);
  insertGroup.run("grp_empty", "休止中の団体", "disabled", 4_000, 4_000);

  const insertMember = sqlite.prepare(
    `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
  );
  insertMember.run("mem_1", "grp_robotics", "usr_taro", "admin", 0, 0);
  insertMember.run("mem_2", "grp_robotics", "usr_hanako", "member", 0, 0);
  insertMember.run("mem_3", "grp_robotics", "usr_jiro", "member", 0, 0);
  insertMember.run("mem_4", "grp_ai", "usr_taro", "member", 0, 0);
  insertMember.run("mem_5", "grp_band", "usr_hanako", "admin", 0, 0);
  // grp_empty にはメンバーがいない

  return sqlite;
};

const createTestDb = () => {
  const sqlite = createDatabase();
  // 型は D1 版に合わせる。better-sqlite3 版も同じ問い合わせを組み立て、await で結果を返す
  const db = drizzle(sqlite, { schema }) as unknown as Database;
  return { sqlite, db };
};

describe("所属団体の一覧（createUserGroupListQuery）", () => {
  it("自分の所属だけでなく、その団体のメンバー全員を数える", async () => {
    const { db } = createTestDb();

    const result = await createUserGroupListQuery(db).findByUserId("usr_taro");

    expect(result._unsafeUnwrap().map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
      // 団体名の昇順（"AI 研究会" < "ロボット部"）
      { id: "grp_ai", memberCount: 1 },
      { id: "grp_robotics", memberCount: 3 },
    ]);
  });
});

describe("事務局向けの団体一覧（createGroupSearchQuery）", () => {
  it("すべての状態を出すときは団体名の順に並べ、メンバーが 0 人の団体も落とさない", async () => {
    const { db } = createTestDb();

    const result = await createGroupSearchQuery(db).findList({ status: null });

    // SQLite の既定の比較は UTF-8 のバイト順なので、英字 → カタカナ → 漢字の順になる
    expect(result._unsafeUnwrap().map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
      { id: "grp_ai", memberCount: 1 },
      { id: "grp_robotics", memberCount: 3 },
      { id: "grp_empty", memberCount: 0 },
      { id: "grp_band", memberCount: 1 },
    ]);
  });

  it("承認待ちだけを出すときは、待たせている順（作成日時の昇順）に並べる", async () => {
    const { db } = createTestDb();

    const result = await createGroupSearchQuery(db).findList({ status: GroupStatus.Pending });

    expect(result._unsafeUnwrap().map(({ id }) => id)).toEqual(["grp_band", "grp_ai"]);
  });

  it("状態ごとの件数を数え、1 件も無い状態は 0 にする", async () => {
    const { sqlite, db } = createTestDb();
    sqlite.prepare(`UPDATE "group" SET status = 'pending' WHERE id = 'grp_empty'`).run();

    const result = await createGroupSearchQuery(db).countByStatus();

    expect(result._unsafeUnwrap()).toEqual({
      [GroupStatus.Pending]: 3,
      [GroupStatus.Enabled]: 1,
      [GroupStatus.Disabled]: 0,
    });
  });
});

describe("団体の状態の更新（GroupRepository.updateStatus）", () => {
  const readStatus = (sqlite: BetterSqlite3.Database, id: string) =>
    (sqlite.prepare(`SELECT status FROM "group" WHERE id = ?`).get(id) as { status: string })
      .status;

  it("今の状態が from と一致すれば、to に変える", async () => {
    const { sqlite, db } = createTestDb();

    const result = await createGroupRepository(db).updateStatus({
      id: "grp_ai",
      from: GroupStatus.Pending,
      to: GroupStatus.Enabled,
      updatedAt: new Date(5_000),
    });

    expect(result._unsafeUnwrap().status).toBe(GroupStatus.Enabled);
    expect(readStatus(sqlite, "grp_ai")).toBe(GroupStatus.Enabled);
  });

  it("先に別の事務局が状態を変えていたら InvalidTransition を返し、上書きしない", async () => {
    const { sqlite, db } = createTestDb();

    // 画面を開いた時点では pending だったが、そのあと別の事務局が無効にした
    sqlite.prepare(`UPDATE "group" SET status = 'disabled' WHERE id = 'grp_ai'`).run();

    const result = await createGroupRepository(db).updateStatus({
      id: "grp_ai",
      from: GroupStatus.Pending,
      to: GroupStatus.Enabled,
      updatedAt: new Date(5_000),
    });

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidTransition);
    expect(readStatus(sqlite, "grp_ai")).toBe(GroupStatus.Disabled);
  });
});
