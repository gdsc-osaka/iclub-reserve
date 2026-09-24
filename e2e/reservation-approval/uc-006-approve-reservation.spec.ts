import { eq } from "drizzle-orm";
import { reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import type { E2eDb } from "../support/db.js";
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

/** 前提: ある団体が申請した仮予約が 1 件ある。施設はこの予約のために作る */
async function createProvisionalReservation(db: E2eDb) {
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
  return { applicant, facility, reservation };
}

test.describe("UC-006 仮予約を承認・却下する", { tag: "@UC-006" }, () => {
  test("事務局が承認すると承認済みになり、承認の通知が積まれる", async ({ page, db, signInAs }) => {
    const { applicant, facility, reservation } = await createProvisionalReservation(db);

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

  test("事務局が理由を入れて却下すると却下済みになり、理由つきの却下の通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "却下" }).click();

    const dialog = page.getByRole("alertdialog", { name: "仮予約の却下" });
    await dialog.getByLabel(/却下理由/).fill("同じ時間に学内行事があるため");
    await dialog.getByRole("button", { name: "却下する" }).click();

    // 仮予約ではなくなったので、既定の一覧からは消える
    await expect(row).toBeHidden();

    // 「終了」に絞り込むと、却下済みとして並んでいる
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /終了/ })
      .click();
    await expect(row.getByText("却下済み", { exact: true })).toBeVisible();

    // 申請者への却下の通知（EVT-006）が、理由つきで積まれている
    const mails = await findQueuedMails(db, applicant.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約が却下されました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes("同じ時間に学内行事があるため"),
      ),
    ).toHaveLength(1);
  });

  test("理由を入れないと却下できない", async ({ page, db, signInAs }) => {
    const { facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "却下" }).click();

    // 理由が空や空白だけのうちは、却下のボタンを押せない（COND-002）
    const dialog = page.getByRole("alertdialog", { name: "仮予約の却下" });
    const rejectButton = dialog.getByRole("button", { name: "却下する" });
    await expect(rejectButton).toBeDisabled();
    await dialog.getByLabel(/却下理由/).fill("   ");
    await expect(rejectButton).toBeDisabled();

    // 予約は仮予約のまま
    const [saved] = await db
      .select()
      .from(reservationTable)
      .where(eq(reservationTable.id, reservation.id));
    expect(saved?.status).toBe(ReservationStatus.Provisional);
  });
});
