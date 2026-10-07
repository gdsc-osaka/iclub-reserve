import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { createGroupAuditLogListQuery } from "./group-audit-log-list-query";
import { useD1TestDb } from "../d1-test-db";

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
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_beta",
      "ベータ研究会",
      "enabled",
      0,
      0,
    ],
  );
});

describe("GroupAuditLogListQuery (本物の D1 を使用したテスト)", () => {
  it("他の団体の記録が混ざらない", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    await testDb.seed([
      insertLogSql,
      "log_alpha_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({ name: { before: "旧名", after: "新名" } }),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_beta_1",
      2000,
      "usr_student_2",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_beta",
      "grp_beta",
      JSON.stringify({ name: { before: "ベータ旧", after: "ベータ新" } }),
    ]);

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("log_alpha_1");
  });

  it("同じ団体でも予約・施設/設備・事務局権限の記録は出ない", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 対象となる記録（group, membership, invitation）
    await testDb.seed([
      insertLogSql,
      "log_group",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_membership",
      2000,
      "usr_student_1",
      0,
      AuditLogAction.MembershipChangeRole,
      AuditLogTargetType.Membership,
      "mem_1",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_invitation",
      3000,
      "usr_student_1",
      0,
      AuditLogAction.InvitationSend,
      AuditLogTargetType.Invitation,
      "inv_1",
      "grp_alpha",
      JSON.stringify({}),
    ]);

    // 対象外の記録（reservation, facility, staff_role）
    await testDb.seed([
      insertLogSql,
      "log_reservation",
      4000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_facility",
      5000,
      "usr_staff",
      1,
      AuditLogAction.FacilityUpdate,
      AuditLogTargetType.Facility,
      "fac_1",
      "grp_alpha", // 通常 facility は group_id=null だが仮に値が入っていても対象外
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_staff_role",
      6000,
      "usr_staff",
      1,
      AuditLogAction.StaffRoleInvite,
      AuditLogTargetType.StaffRole,
      "stf_1",
      "grp_alpha",
      JSON.stringify({}),
    ]);

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    const ids = list.items.map((i) => i.id);
    expect(ids).toEqual(["log_invitation", "log_membership", "log_group"]);
  });

  it("新しい順、同時刻は id 降順で並ぶ", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    await testDb.seed([
      insertLogSql,
      "log_old",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_same_time_a",
      2000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_same_time_b",
      2000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);
    await testDb.seed([
      insertLogSql,
      "log_new",
      3000,
      "usr_student_1",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items.map((i) => i.id)).toEqual([
      "log_new",
      "log_same_time_b",
      "log_same_time_a",
      "log_old",
    ]);
  });

  it("21 件目があると hasNextPage が true、2 ページ目に残りが出る", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 25 件のログを作成
    for (let i = 1; i <= 25; i++) {
      const id = `log_${i.toString().padStart(2, "0")}`;
      await testDb.seed([
        insertLogSql,
        id,
        i * 1000,
        "usr_student_1",
        0,
        AuditLogAction.GroupUpdate,
        AuditLogTargetType.Group,
        "grp_alpha",
        "grp_alpha",
        JSON.stringify({}),
      ]);
    }

    // 1 ページ目 (20 件、hasNextPage: true)
    const page1Result = await query.findByGroupId("grp_alpha", 1);
    expect(page1Result.isOk()).toBe(true);
    const page1 = page1Result._unsafeUnwrap();
    expect(page1.items).toHaveLength(20);
    expect(page1.hasNextPage).toBe(true);
    // 新しい順なので 25 ~ 06 が返る
    expect(page1.items[0].id).toBe("log_25");
    expect(page1.items[19].id).toBe("log_06");

    // 2 ページ目 (残り 5 件、hasNextPage: false)
    const page2Result = await query.findByGroupId("grp_alpha", 2);
    expect(page2Result.isOk()).toBe(true);
    const page2 = page2Result._unsafeUnwrap();
    expect(page2.items).toHaveLength(5);
    expect(page2.hasNextPage).toBe(false);
    expect(page2.items[0].id).toBe("log_05");
    expect(page2.items[4].id).toBe("log_01");
  });

  it("user_id の名前が引ける／削除された操作者は actorName が null", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 1. 存在する操作者と、changes 内の user_id
    await testDb.seed([
      insertLogSql,
      "log_with_user",
      2000,
      "usr_student_1",
      0,
      AuditLogAction.MembershipChangeRole,
      AuditLogTargetType.Membership,
      "mem_1",
      "grp_alpha",
      JSON.stringify({
        role: { before: "member", after: "admin" },
        user_id: { before: "usr_student_2", after: "usr_student_2" },
      }),
    ]);

    // 2. 削除された操作者（user テーブルに存在しない ID）
    await testDb.seed([
      insertLogSql,
      "log_deleted_actor",
      1000,
      "usr_deleted",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      JSON.stringify({}),
    ]);

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(2);

    const log1 = list.items.find((i) => i.id === "log_with_user");
    expect(log1?.actorName).toBe("阪大太郎");
    expect(list.userNames).toEqual({
      usr_student_2: "阪大花子",
    });

    const log2 = list.items.find((i) => i.id === "log_deleted_actor");
    expect(log2?.actorName).toBeNull();
  });
});
