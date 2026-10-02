import { and, eq } from "drizzle-orm";
import { groupMemberTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { createGroup, createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-012 管理者を昇格・降格する（`rdra/contexts/group-management.md`）
 *
 * メンバーの行は名前で探し、行の中の役割（「管理者」「メンバー」）で結果を見る。
 */
test.describe("UC-012 管理者を昇格・降格する", { tag: "@UC-012" }, () => {
  test("管理者が一般メンバーを管理者に上げられる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [
        { userId: admin.id, role: MembershipRole.Admin },
        { userId: member.id, role: MembershipRole.Member },
      ],
    });
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    const row = page.getByRole("listitem").filter({ hasText: member.name });
    await row.getByRole("button", { name: "管理者にする" }).click();
    const dialog = page.getByRole("alertdialog", { name: "管理者にしますか？" });
    await dialog.getByRole("button", { name: "管理者にする" }).click();

    await expect(row.getByText("管理者", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "メンバーにする" })).toBeVisible();
  });

  test("管理者がほかの管理者を一般メンバーに下げられる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const otherAdmin = await createUser(db);
    const group = await createGroup(db, {
      members: [
        { userId: admin.id, role: MembershipRole.Admin },
        { userId: otherAdmin.id, role: MembershipRole.Admin },
      ],
    });
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    const row = page.getByRole("listitem").filter({ hasText: otherAdmin.name });
    await row.getByRole("button", { name: "メンバーにする" }).click();
    const dialog = page.getByRole("alertdialog", { name: "メンバーに戻しますか？" });
    await dialog.getByRole("button", { name: "メンバーにする" }).click();

    await expect(row.getByText("メンバー", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "管理者にする" })).toBeVisible();
  });

  test("最後の管理者は一般メンバーに下げられない", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [
        { userId: admin.id, role: MembershipRole.Admin },
        { userId: member.id, role: MembershipRole.Member },
      ],
    });
    await signInAs(admin.id);

    // ただ 1 人の管理者が、自分を一般メンバーに下げようとする
    await openPage(page, `/groups/${group.id}`);
    const ownRow = page.getByRole("listitem").filter({ hasText: admin.name });
    await ownRow.getByRole("button", { name: "メンバーにする" }).click();
    const dialog = page.getByRole("alertdialog", { name: "メンバーに戻しますか？" });
    await dialog.getByRole("button", { name: "メンバーにする" }).click();

    // 管理者がいなくなるので断られる（COND-016）
    await expect(page.getByText("最後の管理者は降格できません", { exact: false })).toBeVisible();
    await expect(ownRow.getByText("管理者", { exact: true })).toBeVisible();

    const [saved] = await db
      .select()
      .from(groupMemberTable)
      .where(and(eq(groupMemberTable.groupId, group.id), eq(groupMemberTable.userId, admin.id)));
    expect(saved?.role).toBe(MembershipRole.Admin);
  });
});
