import { MembershipRole } from "~/domain/membership";
import { createGroup, createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-013 団体情報を編集する（`rdra/contexts/group-management.md`）
 */
test.describe("UC-013 団体情報を編集する", { tag: "@UC-013" }, () => {
  test("管理者が団体名を変えられる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    const newName = `E2E 改名した団体 ${uniqueSuffix()}`;
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    await page.getByLabel("団体名").fill(newName);
    await page.getByRole("button", { name: "保存する" }).click();

    await expect(page.getByRole("heading", { level: 1, name: newName })).toBeVisible();
  });
});
