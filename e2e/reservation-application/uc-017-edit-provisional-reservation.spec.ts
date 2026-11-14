import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import {
  expectAvailabilityBlocked,
  repickOnAvailabilityCalendar,
  selectAvailabilityTimeRange,
} from "../support/availability-panel.js";
import { nextWeekAt, toDateKey, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { findReservationsOfFacility } from "../support/lookups.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-017 仮予約の内容を編集する（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-017 仮予約の内容を編集する", { tag: "@UC-017" }, () => {
  test("メンバーがカレンダーの欄から施設・時間帯・人数・備考を変えて変更すると、詳細に反映され仮予約のまま通知が積まれる", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    // 前提: 自団体の仮予約が施設 A に 1 件ある
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facilityA = await createFacility(db);
    const facilityB = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facilityA.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Wednesday, 13),
      endAt: nextWeekAt(Weekday.Wednesday, 15),
      headCount: 4,
      note: "変更前の備考",
      status: ReservationStatus.Provisional,
    });
    await signInAs(member.id);

    // 1. カレンダーを開き、予約の帯を押して「予約の内容」の欄を開く
    await openPage(
      page,
      `/availability?facility=${facilityA.id}&date=${toDateKey(reservation.startAt)}`,
    );
    await page.getByRole("button", { name: new RegExp(`${group.name}.*の詳細を見る`) }).click();

    const detailPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(detailPanel).toBeVisible();

    // 2. 欄の「変更」を押すと、同じ欄が「予約の変更」に替わる
    await detailPanel.getByRole("button", { name: "変更" }).click();
    await expect(page).toHaveURL(new RegExp(`edit=${reservation.id}`));

    const panel = page.getByRole("region", { name: "予約の変更" });
    await expect(panel).toBeVisible();

    // 3. スマホでは入力する段階だとカレンダーが隠れているため、選ぶ段階へ戻ってから施設 B に替える（ADR-014 決定 13）
    await repickOnAvailabilityCalendar(panel, isMobile);
    await page.getByRole("button", { name: /施設・設備を選んで切り替え/ }).click();
    await page.getByRole("menuitem", { name: facilityB.name }).click();

    await expect(panel).toBeVisible();
    await expect(panel.getByText(facilityB.name).filter({ visible: true })).toBeVisible();

    // 4. 時間帯・使用人数・備考を変更（スマホは時刻を選び直して「次へ」で入力する段階へ進むと「変更前: 施設 A」も出る）
    await selectAvailabilityTimeRange(page, panel, isMobile, { start: "14:00", end: "16:00" });
    await expect(panel.getByText(`変更前: ${facilityA.name}`)).toBeVisible();

    await panel.getByLabel("使用人数").fill("6");
    await panel.getByLabel("備考").fill("変更後の備考");

    // 確認ダイアログを開く
    await panel.getByRole("button", { name: "変更内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(facilityB.name)).toBeVisible();
    await expect(confirm.getByText(`変更前: ${facilityA.name}`)).toBeVisible();
    await expect(confirm.getByText("14:00〜16:00（2 時間）")).toBeVisible();
    await expect(confirm.getByText("6 名")).toBeVisible();
    await expect(confirm.getByText("変更前: 4 名")).toBeVisible();
    await expect(confirm.getByText("変更後の備考")).toBeVisible();
    await expect(confirm.getByText("変更前: 変更前の備考")).toBeVisible();
    await expect(confirm.getByText("仮予約", { exact: true })).toBeVisible();

    await confirm.getByRole("button", { name: "この内容で変更する" }).click();

    // 5. 送信後、トーストが表示され、URL と欄が変更後の仮予約を表示する
    await expect(page.getByText("予約を変更しました")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`reservation=${reservation.id}`));
    await expect(page).not.toHaveURL(/edit=/);

    const updatedDetailPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(updatedDetailPanel).toBeVisible();
    await expect(updatedDetailPanel.getByText("仮予約", { exact: true })).toBeVisible();
    await expect(updatedDetailPanel.getByText("6 名")).toBeVisible();
    await expect(updatedDetailPanel.getByText("変更後の備考", { exact: true })).toBeVisible();

    // DB の予約の施設が B に変更されている
    const reservationsInB = await findReservationsOfFacility(db, facilityB.id);
    expect(reservationsInB).toHaveLength(1);
    expect(reservationsInB[0]?.id).toBe(reservation.id);

    // 事務局へ仮予約変更通知（EVT-012）が積まれている
    const mails = await findQueuedMails(db, personas.staff.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("仮予約の内容が変更されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);
  });

  test("他団体のメンバーが変更の URL を直接開くと、変更できない旨のエラー画面になる", async ({
    page,
    db,
    signInAs,
  }) => {
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Wednesday, 13),
      endAt: nextWeekAt(Weekday.Wednesday, 15),
      status: ReservationStatus.Provisional,
    });

    const otherUser = await createUser(db);
    await createGroup(db, {
      members: [{ userId: otherUser.id, role: MembershipRole.Member }],
    });
    await signInAs(otherUser.id);

    await openPage(page, `/reservations/${reservation.id}/edit`);
    await expect(
      page.getByRole("heading", { level: 1, name: "この予約は変更できません" }),
    ).toBeVisible();
    await expect(page.getByText("この予約を操作する権限がありません。")).toBeVisible();
  });

  test("承認済みの予約と重なる時間帯を選ぶと、確認へ進めず警告が出る", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      status: ReservationStatus.Provisional,
    });

    // 同じ施設の 14:00〜16:00 に他団体の承認済み予約がある
    const otherUser = await createUser(db);
    const otherGroup = await createGroup(db, {
      members: [{ userId: otherUser.id, role: MembershipRole.Member }],
    });
    await createReservation(db, {
      groupId: otherGroup.id,
      facilityId: facility.id,
      createdBy: otherUser.id,
      startAt: nextWeekAt(Weekday.Wednesday, 14),
      endAt: nextWeekAt(Weekday.Wednesday, 16),
      status: ReservationStatus.Approved,
    });

    await signInAs(member.id);
    await openPage(page, `/reservations/${reservation.id}/edit`);
    await expect(page).toHaveURL(new RegExp(`edit=${reservation.id}`));
    const panel = page.getByRole("region", { name: "予約の変更" });
    await expect(panel).toBeVisible();

    // 重なる時間帯（13:00〜15:00）に変更（14:00〜16:00 の承認済み予約と重複。スマホは選ぶ段階にとどまる）
    await selectAvailabilityTimeRange(page, panel, isMobile, {
      start: "13:00",
      end: "15:00",
      proceed: false,
    });

    // 埋まっている理由が出て、確認・次へ進めない（COND-001）
    await expectAvailabilityBlocked(panel, isMobile, "変更内容を確認する");
  });
});
