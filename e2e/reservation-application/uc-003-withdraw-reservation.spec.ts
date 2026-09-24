import { MembershipRole } from "~/domain/membership";
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
 * UC-003 仮予約を取り消す（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-003 仮予約を取り消す", { tag: "@UC-003" }, () => {
  test("一般メンバーが仮予約を取り消すと取り消し済みになり、取り消しの通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: 自分が申請した仮予約が 1 件ある
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Tuesday, 10),
      endAt: nextWeekAt(Weekday.Tuesday, 12),
    });
    await signInAs(member.id);

    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "取り消し" }).click();

    // 確認のダイアログで取り消す。理由は任意なので入れない
    const dialog = page.getByRole("alertdialog", { name: "仮予約の取り消し" });
    await dialog.getByRole("button", { name: "取り消す" }).click();

    // 一覧に取り消し済みとして残り、もう取り消せない
    await expect(row.getByText("取り消し済み", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "取り消し" })).toBeHidden();

    // 申請者への取り消しの通知（EVT-002）が積まれている
    const mails = await findQueuedMails(db, member.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("仮予約が取り消されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);
  });
});
