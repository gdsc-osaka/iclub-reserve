import { and, eq } from "drizzle-orm";
import { groupInvitationTable, groupMemberTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { createGroup, createInvitation, createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-011 メンバーを招待・削除する（`rdra/contexts/group-management.md`）
 *
 * 操作するのは、団体の管理画面（SCR-007、`/groups/:groupId`）。
 */
test.describe("UC-011 メンバーを招待・削除する", { tag: "@UC-011" }, () => {
  test("管理者が招待を送ると承諾待ちの一覧に出て、招待の通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    const inviteeEmail = `e2e-invitee-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    await page.getByLabel("メールアドレス").fill(inviteeEmail);
    await page.getByRole("button", { name: "招待する" }).click();

    // 承諾待ちの招待に並ぶ
    await expect(page.getByText("承諾待ちの招待（1 件）")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: inviteeEmail })).toBeVisible();

    // 招待された人への通知（EVT-014）が積まれている
    const mails = await findQueuedMails(db, inviteeEmail);
    expect(
      mails.filter((mail) => mail.subject.includes(`「${group.name}」への招待が届いています`)),
    ).toHaveLength(1);
  });

  test("管理者が承諾待ちの招待を取り消せる", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    const invitation = await createInvitation(db, {
      groupId: group.id,
      email: `e2e-invitee-${uniqueSuffix()}@ecs.osaka-u.ac.jp`,
      inviterId: admin.id,
    });
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    await page.getByRole("button", { name: `${invitation.email} への招待を取り消す` }).click();
    const dialog = page.getByRole("alertdialog", { name: "招待を取り消しますか？" });
    await dialog.getByRole("button", { name: "取り消す" }).click();

    await expect(page.getByText("承諾待ちの招待はありません")).toBeVisible();

    const [saved] = await db
      .select()
      .from(groupInvitationTable)
      .where(eq(groupInvitationTable.id, invitation.id));
    expect(saved?.status).toBe(InvitationStatus.Canceled);
  });

  test("管理者がメンバーを団体から外せる", async ({ page, db, signInAs }) => {
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
    await page.getByRole("button", { name: `${member.name} を団体から削除` }).click();
    const dialog = page.getByRole("alertdialog", { name: "団体から削除しますか？" });
    await dialog.getByRole("button", { name: "削除する" }).click();

    // ダイアログが開いている間は、画面の残りが読み上げの対象から外れ、行が「見えない」扱いになる。
    // 削除が終わってダイアログが閉じるのを待ってから、一覧を確かめる
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("listitem").filter({ hasText: member.name })).toBeHidden();

    const memberships = await db
      .select()
      .from(groupMemberTable)
      .where(and(eq(groupMemberTable.groupId, group.id), eq(groupMemberTable.userId, member.id)));
    expect(memberships).toHaveLength(0);
  });

  test("大阪大学以外のアドレスには招待を送れない", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: admin.id, role: MembershipRole.Admin }],
    });
    await signInAs(admin.id);

    await openPage(page, `/groups/${group.id}`);
    const emailInput = page.getByLabel("メールアドレス");
    await emailInput.fill(`e2e-${uniqueSuffix()}@example.com`);
    await page.getByRole("button", { name: "招待する" }).click();

    // 入力欄が誤りとして示される（COND-022）。
    // 誤りの文言は、入力欄の下にいつも出ている案内と同じ文なので、文言ではなく欄の状態で確かめる
    await expect(emailInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("承諾待ちの招待はありません")).toBeVisible();

    const invitations = await db
      .select()
      .from(groupInvitationTable)
      .where(eq(groupInvitationTable.groupId, group.id));
    expect(invitations).toHaveLength(0);
  });
});
