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
    await row.getByRole("button", { name: "承認" }).click();
    const dialog = page.getByRole("alertdialog", { name: `${group.name} を承認しますか？` });
    await dialog.getByRole("button", { name: "承認する" }).click();

    await expect(page.getByText(`${group.name} を「有効」にしました。`)).toBeVisible();
    await expect(row).toBeHidden();

    // 「有効」に絞り込むと、有効として並んでいる
    await page
      .getByRole("navigation", { name: "状態の絞り込み" })
      .getByRole("link", { name: /有効/ })
      .click();
    await expect(row.getByText("有効", { exact: true })).toBeVisible();
  });

  test("事務局が有効な団体を無効にできる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    await signInAs(personas.staff.id);

    await openPage(page, "/staff/groups");
    const statusFilter = page.getByRole("navigation", { name: "状態の絞り込み" });
    await statusFilter.getByRole("link", { name: /有効/ }).click();
    const row = groupRow(page, group.name);
    await row.getByRole("button", { name: "無効化" }).click();
    const dialog = page.getByRole("alertdialog", { name: `${group.name} を無効にしますか？` });
    await dialog.getByRole("button", { name: "無効化する" }).click();

    await expect(page.getByText(`${group.name} を「無効」にしました。`)).toBeVisible();
    await expect(row).toBeHidden();

    await statusFilter.getByRole("link", { name: /無効/ }).click();
    await expect(row.getByText("無効", { exact: true })).toBeVisible();
  });

  test("事務局のダッシュボード（SCR-022）に承認待ちの団体が出て、団体の画面を開ける", async ({
    page,
    db,
    signInAs,
  }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      status: GroupStatus.Pending,
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
      /*
       * ダッシュボードには登録の古い 5 件しか出ないので、ほかのテストが残した承認待ちの団体より
       * 先に並ぶよう、遅く作るほど古い登録日にする（同じ回に 5 種類のブラウザで流しても押し出されない）
       */
      createdAt: new Date(-Date.now()),
    });
    await signInAs(personas.staff.id);

    await openPage(page, "/staff");
    const section = page.getByRole("region", { name: "承認待ちの団体" });
    await section.getByRole("link", { name: new RegExp(group.name) }).click();

    await expect(page).toHaveURL(new RegExp(`/staff/groups/${group.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: group.name })).toBeVisible();
  });
});
