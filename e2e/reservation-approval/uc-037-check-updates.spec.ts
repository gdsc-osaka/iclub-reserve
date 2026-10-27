import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import type { E2eDb } from "../support/db.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createReservationMessage,
  createUser,
  uniqueSuffix,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-037 確認が必要なことを確認する（`rdra/contexts/reservation-approval.md`）
 *
 * ダッシュボード（SCR-022、利用者は `/`、事務局は `/staff`）の「確認が必要なこと」区画。
 * COND-026（未読の判定）、INFO-012（既読の記録）。
 */

async function setupReservationWithMembers(db: E2eDb) {
  const applicant = await createUser(db);
  const admin = await createUser(db);
  const member = await createUser(db);

  const group = await createGroup(db, {
    members: [
      { userId: applicant.id, role: MembershipRole.Member },
      { userId: admin.id, role: MembershipRole.Admin },
      { userId: member.id, role: MembershipRole.Member },
    ],
  });

  const facility = await createFacility(db);
  const reservation = await createReservation(db, {
    groupId: group.id,
    facilityId: facility.id,
    createdBy: applicant.id,
    startAt: nextWeekAt(Weekday.Thursday, 13),
    endAt: nextWeekAt(Weekday.Thursday, 15),
  });

  return { applicant, admin, member, group, facility, reservation };
}

test.describe("UC-037 確認が必要なことを確認する", { tag: "@UC-037" }, () => {
  test("事務局がメッセージを送ると申請者のダッシュボードに出て、「確認済み」を押すと消える", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, reservation } = await setupReservationWithMembers(db);

    const messageBody = `事務局からのご連絡です ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: personas.staff.id,
      sentAsStaff: true,
      body: messageBody,
    });

    await signInAs(applicant.id);
    await openPage(page, "/");

    // ダッシュボードの「確認が必要なこと」にメッセージが表示されていること
    const inbox = page.getByRole("region", { name: /確認が必要なこと/ });
    await expect(inbox.getByText("事務局からメッセージ")).toBeVisible();
    await expect(inbox.getByText(messageBody)).toBeVisible();

    // 「確認済み」をクリックすると行が消えること
    await page.getByRole("button", { name: "確認済み", exact: true }).click();
    await expect(page.getByText(messageBody)).toBeHidden();
    await expect(page.getByText("確認が必要なことはありません")).toBeVisible();
  });

  test("予約詳細を開くと、ダッシュボードから消える", async ({ page, db, signInAs }) => {
    const { applicant, reservation } = await setupReservationWithMembers(db);

    const messageBody = `詳細確認で既読になるメッセージ ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: personas.staff.id,
      sentAsStaff: true,
      body: messageBody,
    });

    await signInAs(applicant.id);
    await openPage(page, "/");

    // ダッシュボードに表示されていることを確認
    await expect(page.getByText(messageBody)).toBeVisible();

    // 行を押して予約詳細画面へ移動する
    await page.getByRole("link", { name: /事務局からメッセージ/ }).click();
    await expect(page).toHaveURL(`/reservations/${reservation.id}`);
    await expect(page.getByText(messageBody)).toBeVisible();

    // ダッシュボードに戻ると既読になって消えていること
    await openPage(page, "/");
    await expect(page.getByText(messageBody)).toBeHidden();
    await expect(page.getByText("確認が必要なことはありません")).toBeVisible();
  });

  test("申請者でも管理者でもない一般メンバーには出ない", async ({ page, db, signInAs }) => {
    const { member, reservation } = await setupReservationWithMembers(db);

    const messageBody = `一般メンバーには見えないメッセージ ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: personas.staff.id,
      sentAsStaff: true,
      body: messageBody,
    });

    // 何も関与していない一般メンバーでログイン
    await signInAs(member.id);
    await openPage(page, "/");

    // ダッシュボードには出ないこと（権限の境目: COND-026 (2)）
    await expect(page.getByText(messageBody)).toBeHidden();
    await expect(page.getByText("確認が必要なことはありません")).toBeVisible();
  });

  test("団体がメッセージを送ると事務局のダッシュボードに出て、別の事務局が返信すると消える", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, reservation } = await setupReservationWithMembers(db);
    const otherStaff = await createUser(db, { is_staff: true });

    const messageBody = `団体からの問い合わせ ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: applicant.id,
      sentAsStaff: false,
      body: messageBody,
    });

    await signInAs(personas.staff.id);
    await openPage(page, "/staff");

    const section = page.getByRole("region", { name: "団体からの未読メッセージ" });
    await expect(section.getByText(messageBody)).toBeVisible();

    // 別の事務局が事務局として返信する
    const replyBody = `事務局からの返信です ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: otherStaff.id,
      sentAsStaff: true,
      body: replyBody,
    });

    // 事務局の誰かが返信すると、返信していない事務局の一覧からも消える（COND-026 (3)）
    await openPage(page, "/staff");
    await expect(section.getByText(messageBody)).toBeHidden();
  });
});
