import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { createGroup, createInvitation, createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-035 所属団体を確認する（`rdra/contexts/group-management.md`）
 */
test.describe("UC-035 所属団体を確認する", { tag: "@UC-035" }, () => {
  test("団体一覧に所属団体が状態つきで出て、ダッシュボードには承認待ちの案内が出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const enabledGroup = await createGroup(db, {
      members: [{ userId: user.id, role: MembershipRole.Member }],
    });
    const pendingGroup = await createGroup(db, {
      status: GroupStatus.Pending,
      members: [{ userId: user.id, role: MembershipRole.Admin }],
    });
    await signInAs(user.id);

    // 団体一覧画面（/groups）では所属団体が状態つきで出る
    await openPage(page, "/groups");
    const enabledCard = page.getByRole("link", { name: new RegExp(enabledGroup.name) });
    const pendingCard = page.getByRole("link", { name: new RegExp(pendingGroup.name) });
    await expect(enabledCard.getByText("有効", { exact: true })).toBeVisible();
    await expect(pendingCard.getByText("承認待ち", { exact: true })).toBeVisible();
    // 管理者を務めている団体には、そのことが出る
    await expect(pendingCard.getByText("管理者", { exact: true })).toBeVisible();

    // ダッシュボード（/）では所属団体のカード一覧は出ず、承認待ちの案内が出る
    await openPage(page, "/");
    const pendingNotice = page.getByRole("alert").filter({ hasText: "承認待ちの団体があります" });
    await expect(pendingNotice).toBeVisible();
    await expect(pendingNotice).toContainText(pendingGroup.name);
  });

  test("一般メンバーは団体の画面を読み取り専用で開け、メールアドレスと招待は見えない", async ({
    page,
    db,
    signInAs,
  }) => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [
        { userId: admin.id, role: MembershipRole.Admin },
        { userId: member.id, role: MembershipRole.Member },
      ],
    });
    const invitation = await createInvitation(db, {
      groupId: group.id,
      email: `e2e-invitee-${uniqueSuffix()}@ecs.osaka-u.ac.jp`,
      inviterId: admin.id,
    });
    await signInAs(member.id);

    await openPage(page, `/groups/${group.id}`);

    // 団体名とメンバーの名前は見える
    await expect(page.getByRole("heading", { level: 1, name: group.name })).toBeVisible();
    await expect(page.getByText(admin.name)).toBeVisible();

    // メンバーのメールアドレス・招待・管理の操作は出ない
    await expect(page.getByText(admin.email)).toBeHidden();
    await expect(page.getByText(invitation.email)).toBeHidden();
    await expect(page.getByLabel("団体名")).toBeHidden();
    await expect(page.getByRole("button", { name: "管理者にする" })).toBeHidden();
    await expect(page.getByRole("button", { name: "招待する" })).toBeHidden();
  });

  test("所属していない団体の画面は、見つからない扱いになる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    const outsider = await createUser(db);
    await signInAs(outsider.id);

    const response = await page.goto(`/groups/${group.id}`);

    // 団体があることも分からない（COND-011）
    expect(response?.status()).toBe(404);
    await expect(page.getByText("団体が見つかりません")).toBeVisible();
    await expect(page.getByText(group.name)).toBeHidden();
  });
});
