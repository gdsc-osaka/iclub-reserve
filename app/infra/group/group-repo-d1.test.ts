/**
 * 団体の作成（UC-010）と団体名の変更（UC-013）で、操作履歴（COND-013）が業務データと同じ batch で
 * 書かれることを、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 団体の状態の更新（updateStatus）は `group-list-d1.test.ts` で確かめている。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { useD1TestDb } from "../d1-test-db";
import { createGroupRepository } from "./group-repo";

const testDb = useD1TestDb();

const NOW = new Date("2026-04-01T10:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_taro",
      "太郎",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_robotics",
      "ロボティクス",
      "enabled",
      0,
      0,
    ],
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

describe("団体の作成（GroupRepository.create）", () => {
  const createAuditLog = (groupId: string): AuditLogDraft => ({
    occurredAt: NOW,
    actorId: "usr_taro",
    actedAsStaff: false,
    action: AuditLogAction.GroupCreate,
    targetId: groupId,
    groupId,
    changes: {
      name: { before: null, after: "AI 班" },
      status: { before: null, after: GroupStatus.Pending },
    },
  });

  it("団体・初期の管理者と一緒に、操作履歴がちょうど 1 行入る", async () => {
    const result = await createGroupRepository(testDb.db).create(
      {
        id: "grp_ai",
        name: "AI 班",
        ownerUserId: "usr_taro",
        membershipId: "mem_new",
        now: NOW,
      },
      createAuditLog("grp_ai"),
    );

    expect(result._unsafeUnwrap().id).toBe("grp_ai");

    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.GroupCreate,
      target_type: "group",
      target_id: "grp_ai",
      group_id: "grp_ai",
    });
    expect(JSON.parse(rows[0].changes)).toEqual(createAuditLog("grp_ai").changes);
  });

  it("団体を書けなかったとき（ID の重複）は、batch ごと巻き戻って操作履歴も残らない", async () => {
    const result = await createGroupRepository(testDb.db).create(
      {
        id: "grp_robotics",
        name: "AI 班",
        ownerUserId: "usr_taro",
        membershipId: "mem_new",
        now: NOW,
      },
      createAuditLog("grp_robotics"),
    );

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(await auditLogRows()).toEqual([]);
  });
});

describe("団体名の変更（GroupRepository.updateName）", () => {
  const renameAuditLog: AuditLogDraft = {
    occurredAt: NOW,
    actorId: "usr_taro",
    actedAsStaff: false,
    action: AuditLogAction.GroupUpdate,
    targetId: "grp_robotics",
    groupId: "grp_robotics",
    changes: { name: { before: "ロボティクス", after: "ロボット部" } },
  };

  it("団体があれば名前を変え、操作履歴がちょうど 1 行入る", async () => {
    const result = await createGroupRepository(testDb.db).updateName(
      { id: "grp_robotics", name: "ロボット部", updatedAt: NOW },
      renameAuditLog,
    );

    expect(result._unsafeUnwrap().name).toBe("ロボット部");

    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.GroupUpdate,
      target_type: "group",
      target_id: "grp_robotics",
      group_id: "grp_robotics",
    });
    expect(JSON.parse(rows[0].changes)).toEqual(renameAuditLog.changes);
  });

  it("団体が無ければ NotFound を返し、操作履歴も入らない", async () => {
    const result = await createGroupRepository(testDb.db).updateName(
      { id: "grp_missing", name: "ロボット部", updatedAt: NOW },
      { ...renameAuditLog, targetId: "grp_missing", groupId: "grp_missing" },
    );

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
    expect(await auditLogRows()).toEqual([]);
  });
});
