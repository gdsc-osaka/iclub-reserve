import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-004 承認済み予約をキャンセルする（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-004 承認済み予約をキャンセルする", { tag: "@UC-004" }, () => {
  test("一般メンバーが承認済みの予約をキャンセルするとキャンセル済みになり、キャンセルの通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: 自分が申請し、承認された予約が 1 件ある
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Friday, 15),
      endAt: nextWeekAt(Weekday.Friday, 17),
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "キャンセル" }).click();

    // 確認のダイアログで、理由を添えてキャンセルする
    const dialog = page.getByRole("alertdialog", { name: "予約のキャンセル" });
    await dialog.getByLabel(/キャンセル理由/).fill("サークルの予定が変わったため");
    await dialog.getByRole("button", { name: "キャンセルする" }).click();

    // 一覧にキャンセル済みとして残る
    await expect(row.getByText("キャンセル済み", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "キャンセル" })).toBeHidden();

    // 申請者へのキャンセルの通知（EVT-003）が、理由つきで積まれている
    const mails = await findQueuedMails(db, member.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約がキャンセルされました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes("サークルの予定が変わったため"),
      ),
    ).toHaveLength(1);
  });
});
