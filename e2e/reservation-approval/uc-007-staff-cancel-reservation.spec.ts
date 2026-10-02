import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
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
 * UC-007 承認済み予約をキャンセルする（事務局）（`rdra/contexts/reservation-approval.md`）
 */
test.describe("UC-007 承認済み予約をキャンセルする（事務局）", { tag: "@UC-007" }, () => {
  test("事務局が理由を入れて承認済みの予約をキャンセルすると事務局キャンセル済みになり、理由つきの通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: ある団体の承認済みの予約が 1 件ある
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Friday, 10),
      endAt: nextWeekAt(Weekday.Friday, 12),
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);

    // 事務局の予約一覧は既定で仮予約だけを出すので、承認済みに絞り込む
    await openPage(page, "/staff/reservations");
    const statusFilter = page.getByRole("navigation", { name: "ステータスの絞り込み" });
    await statusFilter.getByRole("link", { name: /承認済み/ }).click();

    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "キャンセル" }).click();

    const dialog = page.getByRole("alertdialog", { name: "予約のキャンセル（事務局）" });
    await dialog.getByLabel(/キャンセル理由/).fill("施設の点検が入ったため");
    await dialog.getByRole("button", { name: "キャンセルする" }).click();

    // 承認済みではなくなったので、この一覧からは消える
    await expect(row).toBeHidden();

    // 「終了」に絞り込むと、事務局キャンセル済みとして並んでいる
    await statusFilter.getByRole("link", { name: /終了/ }).click();
    await expect(row.getByText("事務局キャンセル済み", { exact: true })).toBeVisible();

    // 申請者への通知（EVT-007）が、理由つきで積まれている
    const mails = await findQueuedMails(db, applicant.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("事務局によりキャンセルされました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes("施設の点検が入ったため"),
      ),
    ).toHaveLength(1);
  });
});
