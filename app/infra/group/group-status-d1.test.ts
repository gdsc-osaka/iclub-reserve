/**
 * 団体の状態の更新（UC-014、`GroupRepository.updateStatus`）を、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 条件付き UPDATE と操作履歴の同一 batch での書き込み（COND-013）が、実際の DB で意図どおりに動くことを押さえる。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { useD1TestDb } from "../d1-test-db";
import { seedGroup, seedUser } from "../d1-test-seeds";
import { createGroupRepository } from "./group-repo";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_taro", name: "太郎", email: "taro@ecs.osaka-u.ac.jp" }),
    seedGroup({
      id: "grp_ai",
      name: "AI 班",
      status: GroupStatus.Pending,
      createdAt: new Date(3000),
      updatedAt: new Date(3000),
    }),
  );
});

describe("団体の状態の更新（GroupRepository.updateStatus）", () => {
  const readStatus = async (id: string) =>
    (
      await testDb.d1
        .prepare(`SELECT status FROM "group" WHERE id = ?`)
        .bind(id)
        .first<{ status: string }>()
    )?.status;

  const auditLogsCount = async () =>
    (
      (await testDb.d1.prepare(`SELECT count(*) as count FROM "audit_log"`).first()) as {
        count: number;
      }
    ).count;

  const dummyAuditLog: AuditLogDraft = {
    occurredAt: new Date(5_000),
    actorId: "usr_taro",
    actedAsStaff: true,
    action: AuditLogAction.GroupEnable,
    targetId: "grp_ai",
    groupId: "grp_ai",
    changes: { status: { before: GroupStatus.Pending, after: GroupStatus.Enabled } },
  };

  it("今の状態が from と一致すれば、to に変え、操作履歴が 1 件記録される", async () => {
    const result = await createGroupRepository(testDb.db).updateStatus(
      {
        id: "grp_ai",
        from: GroupStatus.Pending,
        to: GroupStatus.Enabled,
        updatedAt: new Date(5_000),
      },
      dummyAuditLog,
    );

    expect(result._unsafeUnwrap().status).toBe(GroupStatus.Enabled);
    expect(await readStatus("grp_ai")).toBe(GroupStatus.Enabled);
    expect(await auditLogsCount()).toBe(1);
  });

  it("先に別の事務局が状態を変えていたら InvalidTransition を返し、上書きせず履歴も記録されない", async () => {
    // 画面を開いた時点では pending だったが、そのあと別の事務局が無効にした
    await testDb.seed([`UPDATE "group" SET status = 'disabled' WHERE id = 'grp_ai'`]);

    const result = await createGroupRepository(testDb.db).updateStatus(
      {
        id: "grp_ai",
        from: GroupStatus.Pending,
        to: GroupStatus.Enabled,
        updatedAt: new Date(5_000),
      },
      dummyAuditLog,
    );

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidTransition);
    expect(await readStatus("grp_ai")).toBe(GroupStatus.Disabled);
    expect(await auditLogsCount()).toBe(0);
  });
});
