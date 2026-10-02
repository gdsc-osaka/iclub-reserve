import type { Page } from "@playwright/test";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { createGroup, createUser } from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-014 団体を有効化・無効化する（`rdra/contexts/group-management.md`）
 *
 * 事務局の団体の管理（`/staff/groups`）は、既定で承認待ちの団体だけを出す。
 */

/**
 * 団体の一覧の、その団体の行。
 *
 * 操作の結果の通知（トースト）も団体名を含む `listitem` なので、画面の本文（`main`）の中だけで探す。
 * 通知は本文の外に出る。ページ全体で探すと、行が消える前に通知が出たときに 2 つに当たって落ちる。
 */
const groupRow = (page: Page, groupName: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: groupName });

test.describe("UC-014 団体を有効化・無効化する", { tag: "@UC-014" }, () => {
  test("事務局が承認待ちの団体を有効にできる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      status: GroupStatus.Pending,
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    await signInAs(personas.staff.id);

    await openPage(page, "/staff/groups");
    const row = groupRow(page, group.name);
    await row.getByRole("button", { name: "有効化" }).click();
    const dialog = page.getByRole("alertdialog", { name: `${group.name} を有効にしますか？` });
    await dialog.getByRole("button", { name: "有効化する" }).click();

    await expect(page.getByText(`${group.name} を「活動中」にしました。`)).toBeVisible();
    await expect(row).toBeHidden();

    // 「活動中」に絞り込むと、活動中として並んでいる
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /活動中/ })
      .click();
    await expect(row.getByText("活動中", { exact: true })).toBeVisible();
  });

  test("事務局が有効な団体を無効にできる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    await signInAs(personas.staff.id);

    await openPage(page, "/staff/groups");
    const statusFilter = page.getByRole("navigation", { name: "ステータスの絞り込み" });
    await statusFilter.getByRole("link", { name: /活動中/ }).click();
    const row = groupRow(page, group.name);
    await row.getByRole("button", { name: "無効化" }).click();
    const dialog = page.getByRole("alertdialog", { name: `${group.name} を無効にしますか？` });
    await dialog.getByRole("button", { name: "無効化する" }).click();

    await expect(page.getByText(`${group.name} を「停止中」にしました。`)).toBeVisible();
    await expect(row).toBeHidden();

    await statusFilter.getByRole("link", { name: /停止中/ }).click();
    await expect(row.getByText("停止中", { exact: true })).toBeVisible();
  });
});
