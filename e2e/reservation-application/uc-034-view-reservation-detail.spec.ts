import type { Page } from "@playwright/test";
import { formatFullDate, formatTimeRange } from "~/lib/date";
import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
  uniqueSuffix,
} from "../support/factories.js";
import type { E2eDb } from "../support/db.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-034 予約の詳細を確認する（`rdra/contexts/reservation-application.md`）
 *
 * 操作するのは、予約詳細画面（SCR-005、`/reservations/:reservationId`）。
 * 見せる範囲は COND-008 に従う。自団体のメンバーと事務局には全項目を、
 * 他団体の人には団体名・施設・日時・状態だけを見せる。
 */

/**
 * 予約詳細の「予約内容」のカード。
 * 申請者の名前は画面の上のアカウントメニューにも出るので、項目はこのカードの中で探す。
 */
const reservationContent = (page: Page) =>
  page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]').getByText("予約内容", { exact: true }),
  });

/** 他団体の人には見せない項目（使用人数・備考）が、それと分かる値になった予約を作る */
async function createReservationWithDetails(db: E2eDb) {
  const applicant = await createUser(db);
  const group = await createGroup(db, {
    members: [{ userId: applicant.id, role: MembershipRole.Member }],
  });
  const facility = await createFacility(db);
  const note = `機材の搬入があります ${uniqueSuffix()}`;
  const reservation = await createReservation(db, {
    groupId: group.id,
    facilityId: facility.id,
    createdBy: applicant.id,
    startAt: nextWeekAt(Weekday.Thursday, 10),
    endAt: nextWeekAt(Weekday.Thursday, 12),
    headCount: 7,
    note,
  });
  return { applicant, group, facility, reservation, note };
}

test.describe("UC-034 予約の詳細を確認する", { tag: "@UC-034" }, () => {
  test("自団体のメンバーが一覧から予約を開くと、全項目が出る", async ({ page, db, signInAs }) => {
    const { applicant, group, facility, reservation, note } =
      await createReservationWithDetails(db);
    await signInAs(applicant.id);

    await openPage(page, "/reservations");
    await page.getByRole("link", { name: `${facility.name} の予約の詳細を表示` }).click();

    await expect(page).toHaveURL(`/reservations/${reservation.id}`);
    // 誰にでも見せる項目（施設・日時・状態・団体名）
    await expect(page.getByRole("heading", { level: 1, name: facility.name })).toBeVisible();
    await expect(
      page.getByText(
        `${formatFullDate(reservation.startAt)} ${formatTimeRange(reservation.startAt, reservation.endAt)}`,
      ),
    ).toBeVisible();
    await expect(page.getByText("仮予約", { exact: true })).toBeVisible();
    const content = reservationContent(page);
    await expect(content.getByText(group.name, { exact: true })).toBeVisible();
    // 自団体のメンバーにだけ見せる項目
    await expect(content.getByText("7名", { exact: true })).toBeVisible();
    await expect(content.getByText(applicant.name, { exact: true })).toBeVisible();
    await expect(content.getByText(note)).toBeVisible();
    await expect(page.getByText("メッセージ", { exact: true })).toBeVisible();
  });

  test("事務局は、どの団体の予約でも全項目を見られる", async ({ page, db, signInAs }) => {
    const { applicant, reservation, note } = await createReservationWithDetails(db);
    // 事務局の人はどの団体にも入っていない
    await signInAs(personas.staff.id);

    await openPage(page, `/reservations/${reservation.id}`);

    const content = reservationContent(page);
    await expect(content.getByText("7名", { exact: true })).toBeVisible();
    await expect(content.getByText(applicant.name, { exact: true })).toBeVisible();
    await expect(content.getByText(note)).toBeVisible();
  });

  test("他団体の人には、団体名・施設・日時・状態だけが出る", async ({ page, db, signInAs }) => {
    const { applicant, group, facility, reservation, note } =
      await createReservationWithDetails(db);
    const outsider = await createUser(db);
    await createGroup(db, { members: [{ userId: outsider.id, role: MembershipRole.Admin }] });
    await signInAs(outsider.id);

    await openPage(page, `/reservations/${reservation.id}`);

    await expect(page.getByRole("heading", { level: 1, name: facility.name })).toBeVisible();
    await expect(page.getByText("仮予約", { exact: true })).toBeVisible();
    const content = reservationContent(page);
    await expect(content.getByText(group.name, { exact: true })).toBeVisible();
    await expect(
      content.getByText(
        "他の団体の予約のため、公開されている項目（団体名・施設・日時・状態）だけを表示しています。",
      ),
    ).toBeVisible();

    // 使用人数・申請者・備考・メッセージ欄は出ない
    await expect(page.getByText("使用人数", { exact: true })).toBeHidden();
    await expect(page.getByText("7名", { exact: true })).toBeHidden();
    await expect(page.getByText(applicant.name, { exact: true })).toBeHidden();
    await expect(page.getByText(note)).toBeHidden();
    await expect(page.getByText("メッセージ", { exact: true })).toBeHidden();
  });

  test("存在しない予約を開くと、見つからない旨が出る", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await signInAs(member.id);

    await openPage(page, `/reservations/res_e2e_missing_${uniqueSuffix()}`);

    await expect(page.getByText("予約が見つかりません")).toBeVisible();
    await expect(page.getByRole("link", { name: "予約一覧へ戻る" })).toBeVisible();
  });
});
