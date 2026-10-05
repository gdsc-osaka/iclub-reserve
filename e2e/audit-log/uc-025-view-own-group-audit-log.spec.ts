import type { Page } from "@playwright/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { createAuditLog, createGroup, createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/** 一覧のうち、text を含む記録の行 */
const recordOf = (page: Page, text: string) =>
  page.getByRole("list", { name: "操作履歴" }).getByRole("listitem").filter({ hasText: text });

/**
 * UC-025 操作履歴を閲覧する（自団体管理者）（`rdra/contexts/audit-log.md`）
 *
 * 自団体の管理者が団体管理画面（SCR-007）で操作履歴を閲覧する。
 * 自団体の記録のみが表示され、事務局権限による操作は「事務局」と表示され個人名は伏せられる（COND-012）。
 * 一般メンバーには操作履歴欄が表示されない（COND-012(3)）。
 */
test.describe("UC-025 操作履歴を閲覧する（自団体管理者）", { tag: "@UC-025" }, () => {
  test("管理者が自団体の管理画面を開くと操作履歴が見え、事務局権限の操作者は伏せられる", async ({
    page,
    db,
    signInAs,
  }) => {
    const admin = await createUser(db);
    const staff = await createUser(db, { is_staff: true });
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });

    // (a) 管理者自身が行った団体名の変更
    await createAuditLog(db, {
      actorId: admin.id,
      actedAsStaff: false,
      action: AuditLogAction.GroupUpdate,
      targetType: AuditLogTargetType.Group,
      targetId: group.id,
      groupId: group.id,
      changes: {
        name: { before: "変更前の団体名", after: group.name },
      },
    });

    // (b) 事務局が actedAsStaff: true で行ったロールの変更
    await createAuditLog(db, {
      actorId: staff.id,
      actedAsStaff: true,
      action: AuditLogAction.MembershipChangeRole,
      targetType: AuditLogTargetType.Membership,
      targetId: "mem_target",
      groupId: group.id,
      changes: {
        role: { before: MembershipRole.Member, after: MembershipRole.Admin },
      },
    });

    await signInAs(admin.id);
    await openPage(page, `/groups/${group.id}`);

    // (a) 自分の操作は自分の名前で表示される
    const groupUpdate = recordOf(page, "団体情報の編集");
    await expect(groupUpdate).toContainText(admin.name);
    await expect(groupUpdate).toContainText(`名称: 変更前の団体名 → ${group.name}`);

    // (b) 事務局権限の操作は「事務局」と表示される
    const roleChange = recordOf(page, "ロールの変更");
    await expect(roleChange).toContainText("事務局");
    await expect(roleChange).toContainText("役割: メンバー → 管理者");

    // 一覧の中に事務局員の氏名が含まれていない
    await expect(page.getByRole("list", { name: "操作履歴" })).not.toContainText(staff.name);
  });

  test("一般メンバーが開くと操作履歴の一覧が表示されない", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });

    await signInAs(member.id);
    await openPage(page, `/groups/${group.id}`);

    // 一般メンバーには操作履歴欄（リスト）が存在しない
    await expect(page.getByRole("list", { name: "操作履歴" })).toHaveCount(0);
  });
});
