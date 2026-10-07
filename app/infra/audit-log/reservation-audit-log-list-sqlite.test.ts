import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import type { Database } from "../db";
import { createReservationAuditLogListQuery } from "./reservation-audit-log-list-query";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

/** マイグレーションを流した SQLite インメモリ DB を作成する */
const createDatabase = () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") sqlite.exec(statement.trim());
    }
  }

  // 1. ユーザー投入
  const insertUser = sqlite.prepare(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
  );
  insertUser.run("usr_staff", "事務局スタッフ", "staff@osaka-u.ac.jp", 1, 0, 0, 1);
  insertUser.run("usr_student_1", "阪大太郎", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0);
  insertUser.run("usr_student_2", "阪大花子", "hanako@ecs.osaka-u.ac.jp", 1, 0, 0, 0);

  // 2. 団体投入
  const insertGroup = sqlite.prepare(
    `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
  );
  insertGroup.run("grp_alpha", "アルファ部", "enabled", 0, 0);

  // 3. 施設投入
  const insertFacility = sqlite.prepare(
    `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
  );
  insertFacility.run("fac_room_a", "会議室A", 1, 0, 0);
  insertFacility.run("fac_room_b", "会議室B", 1, 0, 0);

  // 4. 予約投入
  const insertReservation = sqlite.prepare(
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  insertReservation.run(
    "rsv_target",
    "grp_alpha",
    "fac_room_a",
    1_700_000_000_000,
    1_700_003_600_000,
    4,
    "provisional",
    "usr_student_1",
    0,
    0,
  );
  insertReservation.run(
    "rsv_other",
    "grp_alpha",
    "fac_room_b",
    1_700_000_000_000,
    1_700_003_600_000,
    4,
    "provisional",
    "usr_student_2",
    0,
    0,
  );

  return sqlite;
};

/**
 * better-sqlite3 版の Drizzle には `db.batch()` が無いので、D1 の代わりに渡した順で結果を返すものを足す。
 *
 * D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、同じ名前の列が 2 つあると
 * 1 つに潰れて後ろの列がずれる。better-sqlite3 ではこれが起きないため、列名が重なる文を渡されたら
 * ここで失敗させて、D1 で壊れる問い合わせをテストで見つけられるようにしている。
 */
const createTestDb = () => {
  const sqlite = createDatabase();
  const batch = (queries: readonly (PromiseLike<unknown> & { toSQL(): { sql: string } })[]) => {
    for (const query of queries) {
      const names = sqlite
        .prepare(query.toSQL().sql)
        .columns()
        .map((column) => column.name);
      if (new Set(names).size !== names.length) {
        throw new Error(`同じ名前の列があり、D1 の batch では列がずれる: ${names.join(", ")}`);
      }
    }
    return Promise.all(queries);
  };
  // 型は D1 版に合わせる。better-sqlite3 版も同じ問い合わせを組み立て、await で結果を返す
  const db = Object.assign(drizzle(sqlite, { schema }), { batch }) as unknown as Database;
  return { sqlite, db };
};

describe("ReservationAuditLogListQuery (SQLite を使用したテスト)", () => {
  it("別の予約の記録と、target_id が同じでも target_type が予約でない記録は混ざらない", async () => {
    const { sqlite, db } = createTestDb();
    const query = createReservationAuditLogListQuery(db);

    const insertLog = sqlite.prepare(
      `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    // 対象の予約の記録
    insertLog.run(
      "log_target_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      JSON.stringify({ head_count: { before: null, after: 4 } }),
    );

    // 別の予約の記録
    insertLog.run(
      "log_other_rsv",
      2000,
      "usr_student_2",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_other",
      "grp_alpha",
      JSON.stringify({ head_count: { before: null, after: 2 } }),
    );

    // target_id が同じ文字列でも target_type が予約でない記録（例: 施設）
    insertLog.run(
      "log_facility_same_id",
      3000,
      "usr_staff",
      1,
      AuditLogAction.FacilityUpdate,
      AuditLogTargetType.Facility,
      "rsv_target",
      null,
      JSON.stringify({ name: { before: "旧", after: "新" } }),
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("log_target_1");
  });

  it("新しい順。同じ occurred_at は id の降順", async () => {
    const { sqlite, db } = createTestDb();
    const query = createReservationAuditLogListQuery(db);

    const insertLog = sqlite.prepare(
      `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    // 時刻違いと同時刻の複数レコード
    insertLog.run(
      "log_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    );
    insertLog.run(
      "log_a",
      2000,
      "usr_staff",
      1,
      AuditLogAction.ReservationApprove,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    );
    insertLog.run(
      "log_z",
      2000,
      "usr_staff",
      1,
      AuditLogAction.ReservationChange,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    );
    insertLog.run(
      "log_3",
      3000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationCancel,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    // occurred_at DESC, id DESC なので log_3 (3000) -> log_z (2000) -> log_a (2000) -> log_1 (1000)
    expect(list.items.map((i) => i.id)).toEqual(["log_3", "log_z", "log_a", "log_1"]);
  });

  it("21 件あると 1 ページ目は 20 件・hasNextPage: true、2 ページ目は 1 件・false", async () => {
    const { sqlite, db } = createTestDb();
    const query = createReservationAuditLogListQuery(db);

    const insertLog = sqlite.prepare(
      `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    for (let i = 1; i <= 21; i++) {
      insertLog.run(
        `log_${String(i).padStart(3, "0")}`,
        1000 + i,
        "usr_student_1",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "rsv_target",
        "grp_alpha",
        "{}",
      );
    }

    const page1Result = await query.findByReservationId("rsv_target", 1);
    expect(page1Result.isOk()).toBe(true);
    const page1 = page1Result._unsafeUnwrap();
    expect(page1.items).toHaveLength(20);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.items[0].id).toBe("log_021");

    const page2Result = await query.findByReservationId("rsv_target", 2);
    expect(page2Result.isOk()).toBe(true);
    const page2 = page2Result._unsafeUnwrap();
    expect(page2.items).toHaveLength(1);
    expect(page2.hasNextPage).toBe(false);
    expect(page2.items[0].id).toBe("log_001");
  });

  it("操作者が user に無ければ actorName: null", async () => {
    const { sqlite, db } = createTestDb();
    const query = createReservationAuditLogListQuery(db);

    const insertLog = sqlite.prepare(
      `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    insertLog.run(
      "log_deleted_user",
      1000,
      "usr_deleted", // 存在しないユーザーID
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].actorName).toBeNull();
  });

  it("changes の user_id・facility_id が userNames・facilityNames に名前で入る。存在しない ID は辞書に入らない。ID が無ければ両方 {}", async () => {
    const { sqlite, db } = createTestDb();
    const query = createReservationAuditLogListQuery(db);

    const insertLog = sqlite.prepare(
      `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    );

    // 1. ID が無い場合
    insertLog.run(
      "log_no_ids",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      JSON.stringify({ head_count: { before: 2, after: 4 } }),
    );

    const result1 = await query.findByReservationId("rsv_target", 1);
    expect(result1.isOk()).toBe(true);
    const list1 = result1._unsafeUnwrap();
    expect(list1.userNames).toEqual({});
    expect(list1.facilityNames).toEqual({});

    // 2. 存在する user_id と facility_id、および存在しない ID を含む場合
    insertLog.run(
      "log_with_ids",
      2000,
      "usr_staff",
      1,
      AuditLogAction.ReservationChange,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      JSON.stringify({
        user_id: { before: "usr_student_1", after: "usr_nonexistent" },
        facility_id: { before: "fac_room_a", after: "fac_nonexistent" },
      }),
    );

    const result2 = await query.findByReservationId("rsv_target", 1);
    expect(result2.isOk()).toBe(true);
    const list2 = result2._unsafeUnwrap();
    expect(list2.userNames).toEqual({
      usr_student_1: "阪大太郎",
    });
    expect(list2.facilityNames).toEqual({
      fac_room_a: "会議室A",
    });
  });
});
