/**
 * テスト用の D1（`useD1TestDb`）が、ほかのテストの前提にしている性質を満たすかを確かめる。
 *
 * ほかの D1 のテストは「batch は途中で失敗すると全体が巻き戻る」「テストごとに表が空になる」ことに頼っている。
 * ここが崩れると、それらのテストは理由の分からない形で通ったり落ちたりするので、先に押さえておく。
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { groupTable } from "~/db/schema";
import { useD1TestDb } from "./d1-test-db";

const testDb = useD1TestDb();

const NOW = new Date("2026-10-07T10:00:00+09:00");

const insertGroupSql = `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`;

const countGroups = async () =>
  (await testDb.d1.prepare(`SELECT COUNT(*) AS n FROM "group"`).first<{ n: number }>())?.n;

describe("useD1TestDb", () => {
  it("マイグレーション済みの表に、本番と同じ Drizzle で読み書きできる", async () => {
    await testDb.db.insert(groupTable).values({
      id: "grp_1",
      name: "ロボット部",
      status: "enabled",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const rows = await testDb.db.select().from(groupTable).where(eq(groupTable.id, "grp_1"));

    expect(rows).toEqual([
      expect.objectContaining({ id: "grp_1", name: "ロボット部", createdAt: NOW, updatedAt: NOW }),
    ]);
  });

  it("テストごとに表が空になる（直前のテストで入れた行が残っていない）", async () => {
    expect(await countGroups()).toBe(0);
  });

  it("batch は結果を渡した順に返す", async () => {
    const results = await testDb.db.batch([
      testDb.db
        .insert(groupTable)
        .values({ id: "grp_1", name: "A", status: "enabled", createdAt: NOW, updatedAt: NOW })
        .returning({ id: groupTable.id }),
      testDb.db.select({ id: groupTable.id }).from(groupTable),
    ]);

    expect(results).toEqual([[{ id: "grp_1" }], [{ id: "grp_1" }]]);
  });

  it("batch の途中の文が失敗すると、それより前の文も巻き戻る", async () => {
    await testDb.seed([insertGroupSql, "grp_1", "既存", "enabled", 0, 0]);

    await expect(
      testDb.db.batch([
        testDb.db
          .insert(groupTable)
          .values({ id: "grp_2", name: "新規", status: "enabled", createdAt: NOW, updatedAt: NOW }),
        // 主キーの重複で失敗させる
        testDb.db
          .insert(groupTable)
          .values({ id: "grp_1", name: "重複", status: "enabled", createdAt: NOW, updatedAt: NOW }),
      ]),
    ).rejects.toThrow();

    expect(await countGroups()).toBe(1);
  });

  describe("seed", () => {
    it("失敗すると例外を投げる", async () => {
      await expect(
        testDb.seed(
          [insertGroupSql, "grp_1", "A", "enabled", 0, 0],
          [insertGroupSql, "grp_1", "重複", "enabled", 0, 0],
        ),
      ).rejects.toThrow();
    });

    it("引用符・改行・null・真偽値を、そのままの値で入れる", async () => {
      await testDb.seed(
        [insertGroupSql, "grp_1", "O'Reilly\n研究会\r\n第 2 部", "enabled", 0, 0],
        [
          `INSERT INTO "facility" (id, name, description, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
          "fac_1",
          "会議室? A",
          null,
          false,
          0,
          0,
        ],
      );

      expect(await testDb.d1.prepare(`SELECT name FROM "group"`).first()).toEqual({
        name: "O'Reilly\n研究会\r\n第 2 部",
      });
      expect(
        await testDb.d1.prepare(`SELECT name, description, is_active FROM "facility"`).first(),
      ).toEqual({ name: "会議室? A", description: null, is_active: 0 });
    });

    it("SQL が複数行でも 1 文として流す", async () => {
      await testDb.seed([
        `INSERT INTO "group" (id, name, status, created_at, updated_at)
         VALUES (?,?,?,?,?)`,
        "grp_1",
        "A",
        "enabled",
        0,
        0,
      ]);

      expect(await countGroups()).toBe(1);
    });

    it("日時をそのまま渡すと、ミリ秒に直すよう促して止める", async () => {
      await expect(testDb.seed([insertGroupSql, "grp_1", "A", "enabled", NOW, 0])).rejects.toThrow(
        /getTime/,
      );
    });

    it("? と値の数が合わなければ止める", async () => {
      await expect(testDb.seed([insertGroupSql, "grp_1", "A", "enabled", 0])).rejects.toThrow(
        /足りない/,
      );
      await expect(testDb.seed([insertGroupSql, "grp_1", "A", "enabled", 0, 0, 0])).rejects.toThrow(
        /多すぎる/,
      );
    });
  });

  it("外部キーが効いている（存在しない団体へのメンバーは入れられない）", async () => {
    await expect(
      testDb.seed([
        `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
        "mem_1",
        "grp_missing",
        "usr_missing",
        "admin",
        0,
        0,
      ]),
    ).rejects.toThrow();
  });

  it("外部キーでつながった行があっても、reset で空にできる", async () => {
    await testDb.seed(
      [
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_1",
        "太郎",
        "taro@ecs.osaka-u.ac.jp",
        1,
        0,
        0,
        0,
      ],
      [insertGroupSql, "grp_1", "A", "enabled", 0, 0],
      [
        `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
        "mem_1",
        "grp_1",
        "usr_1",
        "admin",
        0,
        0,
      ],
    );

    await testDb.reset();

    expect(await countGroups()).toBe(0);
  });
});
