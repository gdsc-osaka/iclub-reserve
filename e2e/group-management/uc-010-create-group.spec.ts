import { eq } from "drizzle-orm";
import { groupMemberTable, groupTable } from "~/db/schema";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-010 団体を新規作成する（`rdra/contexts/group-management.md`）
 */
test.describe("UC-010 団体を新規作成する", { tag: "@UC-010" }, () => {
  test("団体を作ると承認待ちで作られ、作った人が管理者になり、ダッシュボードに承認待ちの案内が出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const groupName = `E2E 新しい団体 ${uniqueSuffix()}`;
    await signInAs(user.id);

    await openPage(page, "/groups/new");
    await page.getByLabel("団体名").fill(groupName);
    await page.getByRole("button", { name: "登録する" }).click();

    // ダッシュボードに戻り、事務局の承認を待っていることが出る
    await expect(page).toHaveURL("/");
    await expect(page.getByText("承認待ちの団体があります")).toBeVisible();
    await expect(
      page.getByText(new RegExp(`${groupName}\\s*は事務局の承認を待っています`)),
    ).toBeVisible();

    // 承認待ちの団体ができ、作った人がその管理者になっている
    const [group] = await db.select().from(groupTable).where(eq(groupTable.name, groupName));
    expect(group?.status).toBe(GroupStatus.Pending);
    const members = await db
      .select()
      .from(groupMemberTable)
      .where(eq(groupMemberTable.groupId, group?.id ?? ""));
    expect(members).toEqual([
      expect.objectContaining({ userId: user.id, role: MembershipRole.Admin }),
    ]);
  });
});
