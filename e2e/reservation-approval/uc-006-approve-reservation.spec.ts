import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-006 仮予約を承認・却下する（`rdra/contexts/reservation-approval.md`）
 */
test.describe("UC-006 仮予約を承認・却下する", { tag: "@UC-006" }, () => {
  test("事務局が承認すると承認済みになり、承認の通知が積まれる", async ({ page, db, signInAs }) => {
    // 前提: ある団体が申請した仮予約が 1 件ある
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Thursday, 13),
      endAt: nextWeekAt(Weekday.Thursday, 15),
    });

    await signInAs(personas.staff.id);

    // 事務局の予約一覧は、既定で仮予約だけを出す
    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "承認" }).click();

    // 確認のダイアログで承認する
    const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
    await dialog.getByRole("button", { name: "承認する" }).click();

    // 仮予約ではなくなったので、既定の一覧からは消える
    await expect(row).toBeHidden();

    // 「承認済み」に絞り込むと、承認済みとして並んでいる
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /承認済み/ })
      .click();
    await expect(row.getByText("承認済み", { exact: true })).toBeVisible();

    // 申請者への承認の通知（EVT-005）が積まれている
    const mails = await findQueuedMails(db, applicant.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約が承認されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);
  });
});
