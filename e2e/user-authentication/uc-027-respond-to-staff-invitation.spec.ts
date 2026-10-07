import { eq } from "drizzle-orm";
import { staffInvitationTable, user } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import type { E2eDb } from "../support/db.js";
import { createStaffInvitation, createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-027 事務局招待を承諾・辞退する（`rdra/contexts/user-authentication.md`）
 *
 * 事務局招待のリンク（`/staff-invitations/:invitationId`）は、事務局招待メールに載っている。
 */

/** 前提: 事務局から、アカウントのある一般ユーザーへ事務局招待が届いている */
async function createStaffInvitedUser(db: E2eDb) {
  const staff = await createUser(db, { is_staff: true });
  const invitee = await createUser(db, { is_staff: false });
  const invitation = await createStaffInvitation(db, {
    email: invitee.email,
    inviterId: staff.id,
  });
  return { staff, invitee, invitation };
}

test.describe("UC-027 事務局招待を承諾・辞退する", { tag: "@UC-027" }, () => {
  test("招待された本人が承諾すると事務局になる", async ({ page, db, signInAs }) => {
    const { invitee, invitation } = await createStaffInvitedUser(db);
    await signInAs(invitee.id);

    await openPage(page, `/staff-invitations/${invitation.id}`);
    await expect(page.getByText("事務局になるとできること")).toBeVisible();
    await page.getByRole("button", { name: "承諾して事務局になる" }).click();

    // 事務局一覧に移り、メンバーに自分が並ぶ
    await expect(page).toHaveURL("/staff/staff-members");
    const ownRow = page.getByRole("main").getByRole("listitem").filter({ hasText: invitee.name });
    await expect(ownRow).toBeVisible();

    // DB 上でも is_staff が true、招待が accepted になっている
    const [savedUser] = await db.select().from(user).where(eq(user.id, invitee.id));
    expect(savedUser?.is_staff).toBe(true);

    const [savedInv] = await db
      .select()
      .from(staffInvitationTable)
      .where(eq(staffInvitationTable.id, invitation.id));
    expect(savedInv?.status).toBe(InvitationStatus.Accepted);
  });

  test("招待された本人が辞退できる", async ({ page, db, signInAs }) => {
    const { invitee, invitation } = await createStaffInvitedUser(db);
    await signInAs(invitee.id);

    await openPage(page, `/staff-invitations/${invitation.id}`);
    await page.getByRole("button", { name: "辞退する" }).click();
    const dialog = page.getByRole("alertdialog", { name: "招待を辞退しますか？" });
    await dialog.getByRole("button", { name: "辞退する" }).click();

    // ダッシュボードに戻る
    await expect(page).toHaveURL("/");

    // DB 上で招待が rejected、is_staff は false のまま
    const [savedInv] = await db
      .select()
      .from(staffInvitationTable)
      .where(eq(staffInvitationTable.id, invitation.id));
    expect(savedInv?.status).toBe(InvitationStatus.Rejected);

    const [savedUser] = await db.select().from(user).where(eq(user.id, invitee.id));
    expect(savedUser?.is_staff).toBe(false);
  });

  test("宛先でない人がリンクを開くと見つからない扱いになる", async ({ page, db, signInAs }) => {
    const { invitation } = await createStaffInvitedUser(db);
    const stranger = await createUser(db, { is_staff: false });
    await signInAs(stranger.id);

    const response = await page.goto(`/staff-invitations/${invitation.id}`);

    // 招待があることも分からない（COND-015）
    expect(response?.status()).toBe(404);
    await expect(page.getByText("招待が見つかりません")).toBeVisible();
    await expect(page.getByText("事務局になるとできること")).toBeHidden();
  });
});
