import { eq } from "drizzle-orm";
import { staffInvitationTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { createStaffInvitation, createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-026 事務局に招待する・招待を取り消す（`rdra/contexts/user-authentication.md`）
 *
 * 操作するのは、事務局管理画面（SCR-019、`/staff/staff-members`）。
 */
test.describe("UC-026 事務局に招待する・招待を取り消す", { tag: "@UC-026" }, () => {
  test("事務局が招待を送ると承諾待ちの一覧に出て、outbox に招待メールが積まれ、取り消しができる", async ({
    page,
    db,
    signInAs,
  }) => {
    const staff = await createUser(db, { is_staff: true });
    const inviteeEmail = `e2e-staff-invitee-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    await signInAs(staff.id);

    await openPage(page, "/staff/staff-members");
    await page.getByLabel("メールアドレス").fill(inviteeEmail);
    await page.getByRole("button", { name: "招待する" }).click();

    // 承諾待ちの一覧に並ぶ
    const inviteeItem = page.getByRole("listitem").filter({ hasText: inviteeEmail });
    await expect(inviteeItem).toBeVisible();

    // outbox に招待通知（EVT-015）が積まれており、リンクに /staff-invitations/ が含まれる
    const mails = await findQueuedMails(db, inviteeEmail);
    expect(mails.length).toBeGreaterThanOrEqual(1);
    const invitationMail = mails.find((m) => m.subject.includes("事務局への招待"));
    expect(invitationMail).toBeDefined();
    expect(invitationMail?.bodyText).toContain("/staff-invitations/");

    // 一覧の「取り消す」ボタンを押して取り消せる
    await page.getByRole("button", { name: `${inviteeEmail} への招待を取り消す` }).click();
    const dialog = page.getByRole("alertdialog", { name: "招待を取り消しますか？" });
    await dialog.getByRole("button", { name: "取り消す" }).click();

    // 取り消し後はダイアログが閉じ、一覧から消える
    await expect(dialog).toBeHidden();
    await expect(inviteeItem).toBeHidden();

    // DB 上でも status が canceled になっている
    const [saved] = await db
      .select()
      .from(staffInvitationTable)
      .where(eq(staffInvitationTable.email, inviteeEmail));
    expect(saved?.status).toBe(InvitationStatus.Canceled);
  });

  test("事務局でない一般ユーザーが開くと 403 画面が表示される", async ({ page, db, signInAs }) => {
    const normalUser = await createUser(db, { is_staff: false });
    await signInAs(normalUser.id);

    await openPage(page, "/staff/staff-members");

    await expect(page.getByRole("heading", { name: "事務局スタッフ専用ページです" })).toBeVisible();
  });

  test("すでに承諾待ちの招待があるアドレスに再度送ろうとすると重複エラーが表示される", async ({
    page,
    db,
    signInAs,
  }) => {
    const staff = await createUser(db, { is_staff: true });
    const duplicateEmail = `e2e-staff-dup-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    await createStaffInvitation(db, {
      email: duplicateEmail,
      inviterId: staff.id,
    });
    await signInAs(staff.id);

    await openPage(page, "/staff/staff-members");
    const emailInput = page.getByLabel("メールアドレス");
    await emailInput.fill(duplicateEmail);
    await page.getByRole("button", { name: "招待する" }).click();

    // 入力欄がエラーとして示され、重複エラー文言が表示される
    await expect(emailInput).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByText(
        "このメールアドレスには、すでに招待を送っています。取り消してから送り直してください。",
      ),
    ).toBeVisible();
  });
});
