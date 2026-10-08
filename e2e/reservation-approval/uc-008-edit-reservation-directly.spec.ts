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
 * UC-008 事務局による予約の直接変更（`rdra/contexts/reservation-approval.md`）
 */
test.describe("UC-008 事務局による予約の直接変更", { tag: "@UC-008" }, () => {
  test("事務局が他団体の承認済み予約の日時・人数・備考を変更すると、承認済みのまま更新され申請者にEVT-017が送られ事務局には送られない", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    // 前提: 管理者がいる他団体の承認済み予約が 1 件ある
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Wednesday, 13),
      endAt: nextWeekAt(Weekday.Wednesday, 15),
      headCount: 4,
      note: "変更前の備考",
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);

    // 事務局の予約一覧（SCR-003）で承認済みに絞り、その予約の行の「変更」を押す
    await openPage(page, "/staff/reservations");
    const statusFilter = page.getByRole("navigation", { name: "ステータスの絞り込み" });
    await statusFilter.getByRole("link", { name: /承認済み/ }).click();

    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("link", { name: /の予約を変更$/ }).click();

    await expect(page).toHaveURL(`/reservations/${reservation.id}/edit`);

    // 直接変更のため「再承認は不要です」が表示され、「再承認が必要です」は表示されない
    await expect(page.getByText("再承認は不要です", { exact: true })).toBeVisible();
    await expect(page.getByText("再承認が必要です")).not.toBeVisible();

    // 時間帯を 14:00〜16:00 に変更
    if (isMobile) {
      await page.getByRole("button", { name: /施設・日時/ }).click();
      const schedule = page.getByRole("dialog", { name: "施設・日時を選ぶ" });
      await schedule.getByRole("combobox", { name: "開始時刻" }).click();
      await page.getByRole("option", { name: "14:00" }).click();
      await schedule.getByRole("combobox", { name: "終了時刻" }).click();
      await page.getByRole("option", { name: "16:00" }).click();
      await schedule.getByRole("button", { name: "決定" }).click();
    } else {
      await page.getByRole("combobox", { name: "開始時刻" }).click();
      await page.getByRole("option", { name: "14:00" }).click();
      await page.getByRole("combobox", { name: "終了時刻" }).click();
      await page.getByRole("option", { name: "16:00" }).click();
    }

    // 人数と備考を変更
    await page.getByLabel("使用人数").fill("6");
    await page.getByLabel("備考").fill("事務局による直接変更の備考");

    // 確認ダイアログを開く
    await page.getByRole("button", { name: "変更内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByText("変更すると、申請者と団体の管理者にお知らせのメールが届きます。"),
    ).toBeVisible();
    await expect(confirm.getByText("再承認は不要です", { exact: true })).toBeVisible();
    await expect(confirm.getByText("再承認が必要です")).not.toBeVisible();
    await expect(confirm.getByText("承認済み", { exact: true })).toBeVisible();

    await confirm.getByRole("button", { name: "この内容で変更する" }).click();

    // 詳細画面に遷移し、完了案内と変更後の内容が表示され、ステータスは承認済みのまま
    await expect(page).toHaveURL(`/reservations/${reservation.id}?edited=changed`);
    await expect(page.getByText("予約を変更しました。")).toBeVisible();
    await expect(page.getByText("承認済み", { exact: true })).toBeVisible();
    await expect(page.getByText("6名")).toBeVisible();
    // 操作履歴欄にも「備考: 変更前の備考 → …」と出るので、値だけの要素に絞る
    await expect(page.getByText("事務局による直接変更の備考", { exact: true })).toBeVisible();

    // 申請者（管理者）へ EVT-017 が積まれている
    const applicantMails = await findQueuedMails(db, applicant.email);
    expect(
      applicantMails.filter(
        (mail) =>
          mail.subject.includes("利用予約が事務局により変更されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);

    // 事務局自身へは EVT-017 のメールは積まれていない
    const staffMails = await findQueuedMails(db, personas.staff.email);
    expect(
      staffMails.filter(
        (mail) =>
          mail.subject.includes("利用予約が事務局により変更されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(0);
  });

  test("他団体のメンバーが変更の URL を直接開くと、変更できない旨のエラー画面になる", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: 別団体の承認済み予約がある
    const otherUser = await createUser(db);
    const otherGroup = await createGroup(db, {
      members: [{ userId: otherUser.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: otherGroup.id,
      facilityId: facility.id,
      createdBy: otherUser.id,
      startAt: nextWeekAt(Weekday.Wednesday, 13),
      endAt: nextWeekAt(Weekday.Wednesday, 15),
      status: ReservationStatus.Approved,
    });

    // 予約に関係のない一般メンバーでログイン
    const member = await createUser(db);
    await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    await signInAs(member.id);

    // 変更 URL を直接開く
    await openPage(page, `/reservations/${reservation.id}/edit`);

    // 権限がないためエラー画面が表示される
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
    // 前提: 同じ施設で 10:00〜12:00 の予約 A と 14:00〜16:00 の承認済み予約 B がある
    const userA = await createUser(db);
    const groupA = await createGroup(db, {
      members: [{ userId: userA.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const reservationA = await createReservation(db, {
      groupId: groupA.id,
      facilityId: facility.id,
      createdBy: userA.id,
      startAt: nextWeekAt(Weekday.Thursday, 10),
      endAt: nextWeekAt(Weekday.Thursday, 12),
      status: ReservationStatus.Approved,
    });

    const userB = await createUser(db);
    const groupB = await createGroup(db, {
      members: [{ userId: userB.id, role: MembershipRole.Member }],
    });
    await createReservation(db, {
      groupId: groupB.id,
      facilityId: facility.id,
      createdBy: userB.id,
      startAt: nextWeekAt(Weekday.Thursday, 14),
      endAt: nextWeekAt(Weekday.Thursday, 16),
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);

    // 予約 A の変更画面を開く
    await openPage(page, `/reservations/${reservationA.id}/edit`);

    // 重なる時間帯（13:00〜15:00）に変更（14:00〜16:00 の承認済み予約と重複）
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await schedule.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "13:00" }).click();
    await schedule.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "15:00" }).click();

    // 埋まっている理由がその場に出る
    await expect(schedule.getByText("この時間帯はすでに埋まっています")).toBeVisible();
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    // 重複により「変更内容を確認する」ボタンが無効化されている
    await expect(page.getByRole("button", { name: "変更内容を確認する" })).toBeDisabled();
  });
});
