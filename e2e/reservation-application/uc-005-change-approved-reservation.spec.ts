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
import { openPage } from "../support/page.js";

/**
 * UC-005 承認済み予約の内容を変更する（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-005 承認済み予約の内容を変更する", { tag: "@UC-005" }, () => {
  test("承認済みの予約の使用人数だけを変えると、承認済みのまま保存される", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: 自団体の承認済み予約が 1 件ある
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
      headCount: 3,
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    // 詳細画面から「変更」を開く
    await openPage(page, `/reservations/${reservation.id}`);
    await page.getByRole("link", { name: "変更" }).click();

    await expect(page).toHaveURL(`/reservations/${reservation.id}/edit`);

    // 使用人数だけを変更する
    await page.getByLabel("使用人数").fill("5");

    await page.getByRole("button", { name: "変更内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(confirm.getByText("5 名")).toBeVisible();
    await expect(confirm.getByText("変更前: 3 名")).toBeVisible();
    // 状態は承認済みのまま
    await expect(confirm.getByText("承認済み", { exact: true })).toBeVisible();

    await confirm.getByRole("button", { name: "この内容で変更する" }).click();

    // 詳細画面に遷移し、完了案内と承認済みのままの内容が表示される
    await expect(page).toHaveURL(`/reservations/${reservation.id}?edited=changed`);
    await expect(page.getByText("予約を変更しました。")).toBeVisible();
    await expect(page.getByText("承認済み", { exact: true })).toBeVisible();
    await expect(page.getByText("5名")).toBeVisible();
  });

  test("時間帯を変えると、確認ダイアログに再承認の警告が出て、変更後は仮予約になる", async ({
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
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    await openPage(page, `/reservations/${reservation.id}/edit`);

    // 時間帯を 13:00〜15:00 に変更
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await schedule.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "13:00" }).click();
    await schedule.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "15:00" }).click();
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    // フォーム上に再承認が必要な警告が出ている
    await expect(page.getByText("再承認が必要です")).toBeVisible();

    await page.getByRole("button", { name: "変更内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(confirm.getByText("再承認が必要です")).toBeVisible();
    await expect(confirm.getByText("仮予約", { exact: true })).toBeVisible();
    await expect(confirm.getByText("（変更前: 承認済み）")).toBeVisible();

    await confirm.getByRole("button", { name: "この内容で変更する" }).click();

    // 変更後は仮予約に戻る
    await expect(page).toHaveURL(`/reservations/${reservation.id}?edited=changed`);
    await expect(page.getByText("予約を変更しました。")).toBeVisible();
    await expect(page.getByText("仮予約", { exact: true })).toBeVisible();
  });

  test("開始日時を過ぎた予約には、一覧・詳細とも「変更」が出ない", async ({
    page,
    db,
    signInAs,
  }) => {
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    // 過去の予約（2 時間前〜1 時間前）
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: twoHoursAgo,
      endAt: oneHourAgo,
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    // 一覧画面（過去の予約を表示）
    await openPage(page, "/reservations?period=past");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: /の予約を変更/ })).toBeHidden();

    // 詳細画面
    await openPage(page, `/reservations/${reservation.id}`);
    await expect(page.getByRole("link", { name: "変更" })).toBeHidden();
  });
});
