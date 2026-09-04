import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { isAllowedEmailAddress } from "~/domain/auth/allowed-email-domain";
import type { Database } from "~/infra/db";
import { chunkRowsForD1, seedData, seedDatabase } from "./seed";

describe("chunkRowsForD1", () => {
  it("プレースホルダが D1 の上限（100 個）を超えないように分割する", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);

    // 12 列なら 1 回あたり 8 行（96 個）まで
    const chunks = chunkRowsForD1(rows, 12);

    expect(chunks.every((chunk) => chunk.length * 12 <= 100)).toBe(true);
    expect(chunks.flat()).toEqual(rows);
  });

  it("上限に収まるときは分割しない", () => {
    const rows = Array.from({ length: 5 }, (_, i) => i);

    expect(chunkRowsForD1(rows, 8)).toEqual([rows]);
  });

  it("1 行だけで上限を超える列数でも、空の塊を作らない", () => {
    const chunks = chunkRowsForD1([1, 2, 3], 200);

    expect(chunks).toEqual([[1], [2], [3]]);
  });

  it("行が 0 件なら塊も作らない", () => {
    expect(chunkRowsForD1([], 10)).toEqual([]);
  });
});

describe("シードデータ", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const reservations = seedData.buildReservations(now);

  const allIds = [
    ...seedData.users.map((row) => row.id),
    ...seedData.groups.map((row) => row.id),
    ...seedData.memberships.map((row) => row.id),
    ...seedData.facilities.map((row) => row.id),
    ...reservations.map((row) => row.id),
  ];

  it("ID はすべて seed_ で始まる（消し直すときの目印になる）", () => {
    expect(allIds.every((id) => id?.startsWith(seedData.idPrefix))).toBe(true);
  });

  it("ID が重複していない", () => {
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("ユーザーのメールアドレスは、ログインを許可しているドメインになっている", () => {
    expect(seedData.users.every((user) => isAllowedEmailAddress(user.email))).toBe(true);
  });

  it("所属は、実在するユーザーと団体だけを指している", () => {
    const userIds = new Set(seedData.users.map((user) => user.id));
    const groupIds = new Set(seedData.groups.map((group) => group.id));

    for (const membership of seedData.memberships) {
      expect(userIds).toContain(membership.userId);
      expect(groupIds).toContain(membership.groupId);
    }
  });

  it("予約は、実在する団体・施設・申請者だけを指している", () => {
    const userIds = new Set(seedData.users.map((user) => user.id));
    const groupIds = new Set(seedData.groups.map((group) => group.id));
    const facilityIds = new Set(seedData.facilities.map((facility) => facility.id));

    for (const reservation of reservations) {
      expect(groupIds).toContain(reservation.groupId);
      expect(facilityIds).toContain(reservation.facilityId);
      expect(userIds).toContain(reservation.createdBy);
    }
  });

  it("予約は必ず「開始 < 終了」で、利用人数は 1 名以上", () => {
    for (const reservation of reservations) {
      expect(reservation.startAt.getTime()).toBeLessThan(reservation.endAt.getTime());
      expect(reservation.headCount).toBeGreaterThan(0);
    }
  });

  it("予約の開始時刻は、日本時間できりのよい時刻になる", () => {
    const approved = reservations.find((row) => row.id === "seed_reservation_approved_hall");

    // 基準時刻の翌日 13:00（日本時間）＝ 04:00（UTC）
    expect(approved?.startAt.toISOString()).toBe("2026-09-05T04:00:00.000Z");
  });

  it("日付が UTC と日本時間でずれる時間帯でも、日本時間の翌日になる", () => {
    // 日本時間では 9/5 5:00。その翌日は 9/6。
    const lateNight = seedData.buildReservations(new Date("2026-09-04T20:00:00.000Z"));
    const approved = lateNight.find((row) => row.id === "seed_reservation_approved_hall");

    expect(approved?.startAt.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });
});

/**
 * 実際に SQLite へ流し込んで確かめる。
 *
 * シードの SQL がマイグレーションと食い違っていないか（列名の間違いなど）と、
 * 削除・挿入の順番が外部キーに違反しないかは、実行してみないと分からない。
 * D1 も中身は SQLite なので、同じマイグレーションを当てた SQLite で代用する。
 */
describe("seedDatabase", () => {
  /** マイグレーション適用済みの、メモリ上の SQLite を用意する。 */
  const createTestDb = () => {
    const sqlite = new BetterSqlite3(":memory:");

    migrate(drizzle(sqlite), { migrationsFolder: "./drizzle/migrations" });
    // D1 と同じ条件にするため、外部キーの検査を有効にする（SQLite の既定は無効）
    sqlite.pragma("foreign_keys = ON");

    // better-sqlite3 版と D1 版は同じ SQLite 方言だが、型としては別物なので読み替える
    return { sqlite, db: drizzle(sqlite, { schema }) as unknown as Database };
  };

  const now = new Date("2026-09-04T00:00:00.000Z");

  it("すべてのテーブルに投入できる", async () => {
    const { sqlite, db } = createTestDb();

    try {
      const summary = await seedDatabase(db, now);

      expect(summary).toEqual({
        users: seedData.users.length,
        groups: seedData.groups.length,
        memberships: seedData.memberships.length,
        facilities: seedData.facilities.length,
        reservations: seedData.buildReservations(now).length,
      });
    } finally {
      sqlite.close();
    }
  });

  it("何度実行しても行が重複しない", async () => {
    const { sqlite, db } = createTestDb();

    try {
      await seedDatabase(db, now);
      await seedDatabase(db, now);

      const countOf = (table: string) =>
        (sqlite.prepare(`select count(*) as count from \`${table}\``).get() as { count: number })
          .count;

      expect(countOf("user")).toBe(seedData.users.length);
      expect(countOf("group")).toBe(seedData.groups.length);
      expect(countOf("membership")).toBe(seedData.memberships.length);
      expect(countOf("facility")).toBe(seedData.facilities.length);
      expect(countOf("reservation")).toBe(seedData.buildReservations(now).length);
    } finally {
      sqlite.close();
    }
  });

  it("シード以外の行には触らない", async () => {
    const { sqlite, db } = createTestDb();

    try {
      await seedDatabase(db, now);
      sqlite
        .prepare(
          "insert into `group` (id, name, is_active, created_at, updated_at) values (?, ?, 1, 0, 0)",
        )
        .run("manual_group", "手で作った団体");

      await seedDatabase(db, now);

      const remaining = sqlite
        .prepare("select id from `group` where id = ?")
        .get("manual_group") as { id: string } | undefined;

      expect(remaining?.id).toBe("manual_group");
    } finally {
      sqlite.close();
    }
  });
});
