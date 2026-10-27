import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus, UnlockArrangement } from "~/domain/reservation";
import {
  unlockArrangementGroupNotice,
  unlockArrangementLabel,
} from "~/domain/reservation/unlock-arrangement";
import { nextWeekAt, Weekday } from "../support/dates.js";
import type { E2eDb } from "../support/db.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
  uniqueSuffix,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-038 解錠の手配を確認・更新する（`rdra/contexts/reservation-approval.md`）
 *
 * 事務局のダッシュボード（SCR-022、`/staff`）の「解錠の手配が要る予約」と、
 * 予約詳細画面（SCR-005、事務局は `/staff/reservations/:reservationId`・利用者は `/reservations/:reservationId`）。
 * COND-027 (4)〜(6)、COND-023、COND-026 (2)、EVT-008。
 */

/**
 * 予約詳細の「予約内容」のカード。
 * 操作履歴のカードにも変更前後の手配の状況が出るため、「解錠の手配」の項目はこのカードの中で探す。
 */
const reservationContent = (page: Page) =>
  page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]').getByText("予約内容", { exact: true }),
  });

/**
 * 承認済み・要手配の予約と、その申請者・団体・施設を新しく作る。
 * 日時を渡さなければ、来週の木曜 13:00〜15:00 にする。
 */
async function createApprovedRequiredReservation(
  db: E2eDb,
  times: { startAt: Date; endAt: Date } = {
    startAt: nextWeekAt(Weekday.Thursday, 13),
    endAt: nextWeekAt(Weekday.Thursday, 15),
  },
) {
  const applicant = await createUser(db);
  const group = await createGroup(db, {
    members: [{ userId: applicant.id, role: MembershipRole.Member }],
  });
  const facility = await createFacility(db);
  const reservation = await createReservation(db, {
    groupId: group.id,
    facilityId: facility.id,
    createdBy: applicant.id,
    startAt: times.startAt,
    endAt: times.endAt,
    status: ReservationStatus.Approved,
    unlockArrangement: UnlockArrangement.Required,
  });
  return { applicant, group, facility, reservation };
}

test.describe("UC-038 解錠の手配を確認・更新する", { tag: "@UC-038" }, () => {
  test("事務局がダッシュボードの要手配の予約から開き、手配済みに変えてメッセージを添える", async ({
    page,
    db,
    signInAs,
  }) => {
    /*
     * ダッシュボードの「解錠の手配が要る予約」には開始の近い 5 件しか出ないため、
     * ほかのテストが残す要手配の予約（UC-006 のダッシュボードのテストは、1 時間後に始まる予約を
     * 要手配で承認して残す）より先に並ぶよう、開始を 1 時間前・終了を 2 時間後（利用中）にする。
     */
    const now = Date.now();
    const { applicant, facility, reservation } = await createApprovedRequiredReservation(db, {
      startAt: new Date(now - 60 * 60 * 1000),
      endAt: new Date(now + 2 * 60 * 60 * 1000),
    });

    await signInAs(personas.staff.id);
    await openPage(page, "/staff");

    // 「解錠の手配が要る予約」の区画にその予約の行が出て、押すと事務局の画面の予約詳細が開く
    const section = page.getByRole("region", { name: "解錠の手配が要る予約" });
    const row = section.getByRole("listitem").filter({ hasText: facility.name });
    await expect(row).toBeVisible();
    await row.getByRole("link").click();

    await expect(page).toHaveURL(`/staff/reservations/${reservation.id}`);

    // 「解錠の手配」の項目が「要手配」になっている
    const content = reservationContent(page);
    await expect(
      content.getByText(unlockArrangementLabel[UnlockArrangement.Required], { exact: true }),
    ).toBeVisible();

    // 「手配の状況を変更」を押し、ダイアログで「手配済み」を選んでメッセージを添えて変更する
    await content.getByRole("button", { name: "手配の状況を変更" }).click();
    const dialog = page.getByRole("alertdialog", { name: "解錠の手配を変更" });
    await expect(dialog).toBeVisible();

    const messageBody = `当日は守衛室で鍵を受け取ってください ${uniqueSuffix()}`;
    await dialog.getByLabel(unlockArrangementLabel[UnlockArrangement.Arranged]).click();
    await dialog.getByLabel("団体へのメッセージ（任意）").fill(messageBody);
    await dialog.getByRole("button", { name: "変更する" }).click();

    // 項目が「手配済み」になり、メッセージ欄にそのメッセージが出る
    await expect(dialog).toBeHidden();
    await expect(
      content.getByText(unlockArrangementLabel[UnlockArrangement.Arranged], { exact: true }),
    ).toBeVisible();
    const messageList = page.getByRole("list", { name: "メッセージの一覧" });
    await expect(messageList.getByText(messageBody)).toBeVisible();

    // DB の unlock_arrangement が手配済みになっている
    await expect
      .poll(async () => {
        const [saved] = await db
          .select()
          .from(reservationTable)
          .where(eq(reservationTable.id, reservation.id));
        return saved?.unlockArrangement;
      })
      .toBe(UnlockArrangement.Arranged);

    // 申請者宛てに積まれたメールの本文に、更新後の状況とメッセージの本文が入る（EVT-008）
    const arrangedLabel = unlockArrangementLabel[UnlockArrangement.Arranged];
    const mails = await findQueuedMails(db, applicant.email);
    const matchedMails = mails.filter(
      (mail) =>
        mail.subject.includes("予約にメッセージが届きました") &&
        mail.bodyText.includes(reservation.id),
    );
    expect(matchedMails).toHaveLength(1);
    expect(matchedMails[0]?.bodyText).toContain(
      `解錠の手配が「${arrangedLabel}」に更新されました。`,
    );
    expect(matchedMails[0]?.bodyText).toContain(messageBody);

    // ダッシュボードに戻ると、手配済みになった予約の行は出ていない
    await openPage(page, "/staff");
    await expect(section.getByRole("listitem").filter({ hasText: facility.name })).toBeHidden();
  });

  test("メッセージを添えずに変えると、団体のダッシュボードの未読と予約詳細の案内で知る", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, facility, reservation } = await createApprovedRequiredReservation(db);

    await signInAs(personas.staff.id);
    await openPage(page, `/staff/reservations/${reservation.id}`);

    // メッセージを添えずに「手配済み」へ変更する
    const content = reservationContent(page);
    await content.getByRole("button", { name: "手配の状況を変更" }).click();
    const dialog = page.getByRole("alertdialog", { name: "解錠の手配を変更" });
    const arrangedLabel = unlockArrangementLabel[UnlockArrangement.Arranged];
    await dialog.getByLabel(arrangedLabel).click();
    await dialog.getByRole("button", { name: "変更する" }).click();

    await expect(content.getByText(arrangedLabel, { exact: true })).toBeVisible();

    // メッセージを添えていないので、申請者宛てのメールは積まれない
    await expect
      .poll(async () => {
        const [saved] = await db
          .select()
          .from(reservationTable)
          .where(eq(reservationTable.id, reservation.id));
        return saved?.unlockArrangement;
      })
      .toBe(UnlockArrangement.Arranged);
    const mails = await findQueuedMails(db, applicant.email);
    expect(mails.filter((mail) => mail.bodyText.includes(reservation.id))).toHaveLength(0);

    // 申請者でログインし直してダッシュボードを開くと、「確認が必要なこと」に更新の行が出る
    await signInAs(applicant.id);
    await openPage(page, "/");

    const unreadTitle = `解錠の手配が「${arrangedLabel}」に更新されました`;
    const inbox = page.getByRole("region", { name: /確認が必要なこと/ });
    const unreadRow = inbox.getByRole("listitem").filter({ hasText: facility.name });
    await expect(unreadRow.getByText(unreadTitle)).toBeVisible();

    // 行を押して利用者の画面の予約詳細を開くと、手配済みの案内が出て、変更ボタンは無い
    await unreadRow.getByRole("link", { name: new RegExp(unreadTitle) }).click();
    await expect(page).toHaveURL(`/reservations/${reservation.id}`);
    await expect(
      page.getByText(unlockArrangementGroupNotice[UnlockArrangement.Arranged]!),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "手配の状況を変更" })).toBeHidden();
  });

  test("今と同じ状況のままでは「変更する」を押せない", async ({ page, db, signInAs }) => {
    const { reservation } = await createApprovedRequiredReservation(db);

    await signInAs(personas.staff.id);
    await openPage(page, `/staff/reservations/${reservation.id}`);

    const content = reservationContent(page);
    await content.getByRole("button", { name: "手配の状況を変更" }).click();

    const dialog = page.getByRole("alertdialog", { name: "解錠の手配を変更" });
    const submitButton = dialog.getByRole("button", { name: "変更する" });

    // 現在の値「要手配」が選ばれており、そのままでは「変更する」を押せない
    await expect(
      dialog.getByLabel(unlockArrangementLabel[UnlockArrangement.Required]),
    ).toBeChecked();
    await expect(submitButton).toBeDisabled();

    // 別の状況「不要」を選ぶと押せるようになる
    await dialog.getByLabel(unlockArrangementLabel[UnlockArrangement.NotRequired]).click();
    await expect(submitButton).toBeEnabled();
  });
});
