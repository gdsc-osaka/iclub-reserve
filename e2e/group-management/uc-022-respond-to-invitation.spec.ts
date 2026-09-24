import { and, eq } from "drizzle-orm";
import { groupInvitationTable, groupMemberTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import type { E2eDb } from "../support/db.js";
import { createGroup, createInvitation, createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-022 招待を承諾・辞退する（`rdra/contexts/group-management.md`）
 *
 * 招待のリンク（`/invitations/:invitationId`）は、招待メールに載っている。
 */

/** 前提: ある団体から、アカウントのある人へ招待が届いている */
async function createInvitedUser(db: E2eDb) {
  const admin = await createUser(db);
  const group = await createGroup(db, {
    members: [{ userId: admin.id, role: MembershipRole.Admin }],
  });
  const invitee = await createUser(db);
  const invitation = await createInvitation(db, {
    groupId: group.id,
    email: invitee.email,
    inviterId: admin.id,
  });
  return { group, invitee, invitation };
}

test.describe("UC-022 招待を承諾・辞退する", { tag: "@UC-022" }, () => {
  test("招待された本人が承諾すると、その団体のメンバーになる", async ({ page, db, signInAs }) => {
    const { group, invitee, invitation } = await createInvitedUser(db);
    await signInAs(invitee.id);

    await openPage(page, `/invitations/${invitation.id}`);
    await expect(page.getByText(group.name)).toBeVisible();
    await page.getByRole("button", { name: "承諾して参加する" }).click();

    // 団体の画面に移り、メンバーに自分が並ぶ
    await expect(page).toHaveURL(`/groups/${group.id}`);
    const ownRow = page.getByRole("listitem").filter({ hasText: invitee.name });
    await expect(ownRow.getByText("あなた", { exact: true })).toBeVisible();
    await expect(ownRow.getByText("メンバー", { exact: true })).toBeVisible();
  });

  test("招待された本人が辞退できる", async ({ page, db, signInAs }) => {
    const { group, invitee, invitation } = await createInvitedUser(db);
    await signInAs(invitee.id);

    await openPage(page, `/invitations/${invitation.id}`);
    await page.getByRole("button", { name: "辞退する" }).click();
    const dialog = page.getByRole("alertdialog", { name: "招待を辞退しますか？" });
    await dialog.getByRole("button", { name: "辞退する" }).click();

    // ダッシュボードに戻り、団体には入っていない
    await expect(page).toHaveURL("/");
    const [saved] = await db
      .select()
      .from(groupInvitationTable)
      .where(eq(groupInvitationTable.id, invitation.id));
    expect(saved?.status).toBe(InvitationStatus.Rejected);
    const memberships = await db
      .select()
      .from(groupMemberTable)
      .where(and(eq(groupMemberTable.groupId, group.id), eq(groupMemberTable.userId, invitee.id)));
    expect(memberships).toHaveLength(0);
  });

  test("宛先でない人が招待のリンクを開くと、見つからない扱いになる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { group, invitation } = await createInvitedUser(db);
    const stranger = await createUser(db);
    await signInAs(stranger.id);

    const response = await page.goto(`/invitations/${invitation.id}`);

    // 招待があることも、どの団体からかも分からない（COND-011）
    expect(response?.status()).toBe(404);
    await expect(page.getByText("招待が見つかりません")).toBeVisible();
    await expect(page.getByText(group.name)).toBeHidden();
  });
});
