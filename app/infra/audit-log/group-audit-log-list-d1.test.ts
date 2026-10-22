import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { useD1TestDb } from "../d1-test-db";
import { seedAuditLog, seedGroup, seedUser } from "../d1-test-seeds";
import { createGroupAuditLogListQuery } from "./group-audit-log-list-query";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({
      id: "usr_staff",
      name: "事務局スタッフ",
      email: "staff@osaka-u.ac.jp",
      is_staff: true,
    }),
    seedUser({
      id: "usr_student_1",
      name: "阪大太郎",
      email: "taro@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedUser({
      id: "usr_student_2",
      name: "阪大花子",
      email: "hanako@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedGroup({ id: "grp_alpha", name: "アルファ部" }),
    seedGroup({ id: "grp_beta", name: "ベータ研究会" }),
  );
});

describe("GroupAuditLogListQuery (本物の D1 を使用したテスト)", () => {
  it("他の団体の記録が混ざらない", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);

    await testDb.seed(
      seedAuditLog({
        id: "log_alpha_1",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
        changes: { name: { before: "旧名", after: "新名" } },
      }),
      seedAuditLog({
        id: "log_beta_1",
        occurredAt: new Date(2000),
        actorId: "usr_student_2",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_beta",
        groupId: "grp_beta",
        changes: { name: { before: "ベータ旧", after: "ベータ新" } },
      }),
    );

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("log_alpha_1");
  });

  it("同じ団体でも予約・施設/設備・事務局権限の記録は出ない", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);

    // 対象となる記録（group, membership, invitation）
    await testDb.seed(
      seedAuditLog({
        id: "log_group",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_membership",
        occurredAt: new Date(2000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.MembershipChangeRole,
        targetType: AuditLogTargetType.Membership,
        targetId: "mem_1",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_invitation",
        occurredAt: new Date(3000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.InvitationSend,
        targetType: AuditLogTargetType.Invitation,
        targetId: "inv_1",
        groupId: "grp_alpha",
      }),
      // 対象外の記録（reservation, facility, staff_role）
      seedAuditLog({
        id: "log_reservation",
        occurredAt: new Date(4000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_facility",
        occurredAt: new Date(5000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.FacilityUpdate,
        targetType: AuditLogTargetType.Facility,
        targetId: "fac_1",
        groupId: "grp_alpha", // 通常 facility は group_id=null だが仮に値が入っていても対象外
      }),
      seedAuditLog({
        id: "log_staff_role",
        occurredAt: new Date(6000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.StaffRoleInvite,
        targetType: AuditLogTargetType.StaffRole,
        targetId: "stf_1",
        groupId: "grp_alpha",
      }),
    );

    const result = await query.findByGroupId("grp_alpha", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    const ids = list.items.map((i) => i.id);
    expect(ids).toEqual(["log_invitation", "log_membership", "log_group"]);
  });

  it("新しい順、同時刻は id 降順で並ぶ", async () => {
    const db = testDb.db;
    const query = createGroupAuditLogListQuery(db);

    await testDb.seed(
      seedAuditLog({
        id: "log_old",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_same_time_a",
        occurredAt: new Date(2000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_same_time_b",
        occurredAt: new Date(2000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_new",
        occurredAt: new Date(3000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
    );

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

    // 25 件のログを作成
    for (let i = 1; i <= 25; i++) {
      const id = `log_${i.toString().padStart(2, "0")}`;
      await testDb.seed(
        seedAuditLog({
          id,
          occurredAt: new Date(i * 1000),
          actorId: "usr_student_1",
          actedAsStaff: false,
          action: AuditLogAction.GroupUpdate,
          targetType: AuditLogTargetType.Group,
          targetId: "grp_alpha",
          groupId: "grp_alpha",
        }),
      );
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

    // 1. 存在する操作者と、changes 内の user_id
    await testDb.seed(
      seedAuditLog({
        id: "log_with_user",
        occurredAt: new Date(2000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.MembershipChangeRole,
        targetType: AuditLogTargetType.Membership,
        targetId: "mem_1",
        groupId: "grp_alpha",
        changes: {
          role: { before: "member", after: "admin" },
          user_id: { before: "usr_student_2", after: "usr_student_2" },
        },
      }),
      // 2. 削除された操作者（user テーブルに存在しない ID）
      seedAuditLog({
        id: "log_deleted_actor",
        occurredAt: new Date(1000),
        actorId: "usr_deleted",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
    );

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
