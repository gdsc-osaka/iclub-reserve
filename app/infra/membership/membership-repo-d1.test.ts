/**
 * 所属の書き込み（役割の変更・削除）と操作履歴（COND-013）を、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * 削除では書き込みの後に行が残らないので、操作履歴は「書き込みの前の状態」を条件にして先に書く
 * （`guardedAuditLogInsert` を参照）。その並びと条件が本物の `db.batch()` で効いていることを、
 * 「所属していない人を削除しても記録が残らない」ことで確かめる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "../d1-test-db";
import { createMembershipRepository } from "./membership-repo";

const testDb = useD1TestDb();

const NOW = new Date("2026-04-01T10:00:00.000Z");

beforeEach(async () => {
  const insertUserSql = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
  const insertGroupSql = `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`;
  const insertMemberSql = `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`;

  await testDb.seed(
    [insertUserSql, "usr_taro", "太郎", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0],
    [insertUserSql, "usr_hanako", "花子", "hanako@ecs.osaka-u.ac.jp", 1, 0, 0, 0],
    [insertGroupSql, "grp_robotics", "ロボティクス", "enabled", 0, 0],
    [insertGroupSql, "grp_ai", "AI 班", "enabled", 0, 0],
    [insertMemberSql, "mem_taro", "grp_robotics", "usr_taro", "admin", 0, 0],
    [insertMemberSql, "mem_hanako", "grp_robotics", "usr_hanako", "member", 0, 0],
  );
});

const auditLogRows = async () =>
  (
    await testDb.d1
      .prepare(`SELECT action, target_type, target_id, group_id, changes FROM "audit_log"`)
      .all<{
        action: string;
        target_type: string;
        target_id: string;
        group_id: string | null;
        changes: string;
      }>()
  ).results;

const roleOf = async (memberId: string) =>
  (
    await testDb.d1
      .prepare(`SELECT role FROM "group_member" WHERE id = ?`)
      .bind(memberId)
      .first<{ role: string }>()
  )?.role;

describe("役割の変更（MembershipRepository.updateRole）", () => {
  const changeRoleAuditLog: AuditLogDraft = {
    occurredAt: NOW,
    actorId: "usr_taro",
    actedAsStaff: false,
    action: AuditLogAction.MembershipChangeRole,
    targetId: "mem_hanako",
    groupId: "grp_robotics",
    changes: {
      user_id: { before: "usr_hanako", after: "usr_hanako" },
      role: { before: MembershipRole.Member, after: MembershipRole.Admin },
    },
  };

  it("所属していれば役割を変え、操作履歴がちょうど 1 行入る", async () => {
    const result = await createMembershipRepository(testDb.db).updateRole(
      {
        groupId: "grp_robotics",
        userId: "usr_hanako",
        role: MembershipRole.Admin,
        updatedAt: NOW,
      },
      changeRoleAuditLog,
    );

    expect(result._unsafeUnwrap()).toBe(1);
    expect(await roleOf("mem_hanako")).toBe(MembershipRole.Admin);

    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.MembershipChangeRole,
      target_type: "membership",
      target_id: "mem_hanako",
      group_id: "grp_robotics",
    });
    expect(JSON.parse(rows[0].changes)).toEqual(changeRoleAuditLog.changes);
  });

  it("別の団体を指定したら役割を変えず、操作履歴も入らない", async () => {
    const result = await createMembershipRepository(testDb.db).updateRole(
      {
        groupId: "grp_ai",
        userId: "usr_hanako",
        role: MembershipRole.Admin,
        updatedAt: NOW,
      },
      { ...changeRoleAuditLog, groupId: "grp_ai" },
    );

    expect(result._unsafeUnwrap()).toBe(0);
    expect(await roleOf("mem_hanako")).toBe(MembershipRole.Member);
    expect(await auditLogRows()).toEqual([]);
  });
});

describe("メンバーの削除（MembershipRepository.remove）", () => {
  const removeAuditLog: AuditLogDraft = {
    occurredAt: NOW,
    actorId: "usr_taro",
    actedAsStaff: false,
    action: AuditLogAction.MembershipRemove,
    targetId: "mem_hanako",
    groupId: "grp_robotics",
    changes: {
      user_id: { before: "usr_hanako", after: "usr_hanako" },
      role: { before: MembershipRole.Member, after: null },
    },
  };

  it("所属していれば削除し、操作履歴がちょうど 1 行入る", async () => {
    const result = await createMembershipRepository(testDb.db).remove(
      "grp_robotics",
      "usr_hanako",
      removeAuditLog,
    );

    expect(result._unsafeUnwrap()).toBe(1);
    expect(await roleOf("mem_hanako")).toBeUndefined();

    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.MembershipRemove,
      target_type: "membership",
      target_id: "mem_hanako",
      group_id: "grp_robotics",
    });
    expect(JSON.parse(rows[0].changes)).toEqual(removeAuditLog.changes);
  });

  it("所属していない人を削除しようとしても、操作履歴は入らない", async () => {
    const result = await createMembershipRepository(testDb.db).remove(
      "grp_ai",
      "usr_hanako",
      removeAuditLog,
    );

    expect(result._unsafeUnwrap()).toBe(0);
    expect(await auditLogRows()).toEqual([]);
  });

  it("同じ人を 2 回削除しても、操作履歴は 1 行だけ", async () => {
    const repository = createMembershipRepository(testDb.db);

    expect(
      (await repository.remove("grp_robotics", "usr_hanako", removeAuditLog))._unsafeUnwrap(),
    ).toBe(1);
    expect(
      (await repository.remove("grp_robotics", "usr_hanako", removeAuditLog))._unsafeUnwrap(),
    ).toBe(0);
    expect(await auditLogRows()).toHaveLength(1);
  });
});
