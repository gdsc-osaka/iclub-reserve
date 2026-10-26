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
import { expect, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-003 仮予約を取り消す（`rdra/contexts/reservation-application.md`）
 */

/** 前提: 自分が申請した仮予約が 1 件ある。施設はこの予約のために作る */
async function createOwnProvisionalReservation(db: E2eDb) {
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
  return { member, facility, reservation };
}

test.describe("UC-003 仮予約を取り消す", { tag: "@UC-003" }, () => {
  test("一般メンバーが仮予約を取り消すと取り消し済みになり、取り消しの通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { member, facility, reservation } = await createOwnProvisionalReservation(db);
    await signInAs(member.id);

    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "取り消し" }).click();

    // 確認のダイアログで、理由を添えて取り消す（理由は必須。COND-002）
    const dialog = page.getByRole("alertdialog", { name: "仮予約の取り消し" });
    await dialog.getByLabel(/取り消し理由/).fill("練習の日程が変わったため");
    await dialog.getByRole("button", { name: "取り消す" }).click();

    // 一覧に取り消し済みとして残り、もう取り消せない
    await expect(row.getByText("取り消し済み", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "取り消し" })).toBeHidden();

    // 申請者への取り消しの通知（EVT-002）が、理由つきで積まれている
    const mails = await findQueuedMails(db, member.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("仮予約が取り消されました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes("練習の日程が変わったため"),
      ),
    ).toHaveLength(1);
  });

  test("理由を入れないと取り消せない", async ({ page, db, signInAs }) => {
    const { member, facility, reservation } = await createOwnProvisionalReservation(db);
    await signInAs(member.id);

    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "取り消し" }).click();

    // 理由が空や空白だけのうちは、取り消すボタンを押せない（COND-002）
    const dialog = page.getByRole("alertdialog", { name: "仮予約の取り消し" });
    const withdrawButton = dialog.getByRole("button", { name: "取り消す" });
    await expect(withdrawButton).toBeDisabled();
    await dialog.getByLabel(/取り消し理由/).fill("   ");
    await expect(withdrawButton).toBeDisabled();

    // 予約は仮予約のまま
    const [saved] = await db
      .select()
      .from(reservationTable)
      .where(eq(reservationTable.id, reservation.id));
    expect(saved?.status).toBe(ReservationStatus.Provisional);
  });
});
