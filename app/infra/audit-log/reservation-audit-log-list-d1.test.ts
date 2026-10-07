import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { createReservationAuditLogListQuery } from "./reservation-audit-log-list-query";
import { useD1TestDb } from "../d1-test-db";

/*
 * Query は内部で `db.batch()` を使う。D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、
 * 同じ名前の列が 2 つあると 1 つに潰れて後ろの列がずれる。ここでは本物の D1 で流しているので、
 * 列名が重なる問い合わせを書けば、下の値の比較がそのまま落ちる。
 */
const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff",
      "事務局スタッフ",
      "staff@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_student_1",
      "阪大太郎",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_student_2",
      "阪大花子",
      "hanako@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_alpha",
      "アルファ部",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_room_a",
      "会議室A",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_room_b",
      "会議室B",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "rsv_target",
      "grp_alpha",
      "fac_room_a",
      1700000000000,
      1700003600000,
      4,
      "provisional",
      "usr_student_1",
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "rsv_other",
      "grp_alpha",
      "fac_room_b",
      1700000000000,
      1700003600000,
      4,
      "provisional",
      "usr_student_2",
      0,
      0,
    ],
  );
});

describe("ReservationAuditLogListQuery (本物の D1 を使用したテスト)", () => {
  it("別の予約の記録と、target_id が同じでも target_type が予約でない記録は混ざらない", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 対象の予約の記録
    await testDb.seed([
      insertLogSql,
      "log_target_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      JSON.stringify({ head_count: { before: null, after: 4 } }),
    ]);

    // 別の予約の記録
    await testDb.seed([
      insertLogSql,
      "log_other_rsv",
      2000,
      "usr_student_2",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_other",
      "grp_alpha",
      JSON.stringify({ head_count: { before: null, after: 2 } }),
    ]);

    // target_id が同じ文字列でも target_type が予約でない記録（例: 施設）
    await testDb.seed([
      insertLogSql,
      "log_facility_same_id",
      3000,
      "usr_staff",
      1,
      AuditLogAction.FacilityUpdate,
      AuditLogTargetType.Facility,
      "rsv_target",
      null,
      JSON.stringify({ name: { before: "旧", after: "新" } }),
    ]);

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("log_target_1");
  });

  it("新しい順。同じ occurred_at は id の降順", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 時刻違いと同時刻の複数レコード
    await testDb.seed([
      insertLogSql,
      "log_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_a",
      2000,
      "usr_staff",
      1,
      AuditLogAction.ReservationApprove,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_z",
      2000,
      "usr_staff",
      1,
      AuditLogAction.ReservationChange,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_3",
      3000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationCancel,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    ]);

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    // occurred_at DESC, id DESC なので log_3 (3000) -> log_z (2000) -> log_a (2000) -> log_1 (1000)
    expect(list.items.map((i) => i.id)).toEqual(["log_3", "log_z", "log_a", "log_1"]);
  });

  it("21 件あると 1 ページ目は 20 件・hasNextPage: true、2 ページ目は 1 件・false", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    for (let i = 1; i <= 21; i++) {
      await testDb.seed([
        insertLogSql,
        `log_${String(i).padStart(3, "0")}`,
        1000 + i,
        "usr_student_1",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "rsv_target",
        "grp_alpha",
        "{}",
      ]);
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
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    await testDb.seed([
      insertLogSql,
      "log_deleted_user",
      1000,
      "usr_deleted", // 存在しないユーザーID
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      "{}",
    ]);

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].actorName).toBeNull();
  });

  it("changes の user_id・facility_id が userNames・facilityNames に名前で入る。存在しない ID は辞書に入らない。ID が無ければ両方 {}", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 1. ID が無い場合
    await testDb.seed([
      insertLogSql,
      "log_no_ids",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "rsv_target",
      "grp_alpha",
      JSON.stringify({ head_count: { before: 2, after: 4 } }),
    ]);

    const result1 = await query.findByReservationId("rsv_target", 1);
    expect(result1.isOk()).toBe(true);
    const list1 = result1._unsafeUnwrap();
    expect(list1.userNames).toEqual({});
    expect(list1.facilityNames).toEqual({});

    // 2. 存在する user_id と facility_id、および存在しない ID を含む場合
    await testDb.seed([
      insertLogSql,
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
    ]);

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
