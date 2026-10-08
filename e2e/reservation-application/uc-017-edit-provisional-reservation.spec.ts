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
 * UC-017 仮予約の内容を編集する（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-017 仮予約の内容を編集する", { tag: "@UC-017" }, () => {
  test("メンバーが一覧の「変更」から使用人数・備考・時間帯を変えて変更すると、詳細に反映され仮予約のまま通知が積まれる", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    // 前提: 自団体の仮予約が 1 件ある
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
      headCount: 4,
      note: "変更前の備考",
      status: ReservationStatus.Provisional,
    });
    await signInAs(member.id);

    // 予約一覧から「変更」を押す
    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("link", { name: /の予約を変更/ }).click();

    await expect(page).toHaveURL(`/reservations/${reservation.id}/edit`);

    // 時間帯を 14:00〜16:00 に変更
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await schedule.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "14:00" }).click();
    await schedule.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "16:00" }).click();
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    // 人数と備考を変更
    await page.getByLabel("使用人数").fill("6");
    await page.getByLabel("備考").fill("変更後の備考");

    // 確認ダイアログを開く
    await page.getByRole("button", { name: "変更内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(confirm.getByText("14:00〜16:00（2 時間）")).toBeVisible();
    await expect(confirm.getByText("6 名")).toBeVisible();
    await expect(confirm.getByText("変更前: 4 名")).toBeVisible();
    await expect(confirm.getByText("変更後の備考")).toBeVisible();
    await expect(confirm.getByText("変更前: 変更前の備考")).toBeVisible();

    await confirm.getByRole("button", { name: "この内容で変更する" }).click();

    // 詳細画面に遷移し、完了案内と変更後の内容が表示される
    await expect(page).toHaveURL(`/reservations/${reservation.id}?edited=changed`);
    await expect(page.getByText("予約を変更しました。")).toBeVisible();
    await expect(page.getByText("仮予約", { exact: true })).toBeVisible();
    await expect(page.getByText("6名")).toBeVisible();
    // 操作履歴欄にも「備考: 変更前の備考 → 変更後の備考」と出るので、値だけの要素に絞る
    await expect(page.getByText("変更後の備考", { exact: true })).toBeVisible();

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

    // 重なる時間帯（13:00〜15:00）に変更（14:00〜16:00 の承認済み予約と重複）
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await schedule.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "13:00" }).click();
    await schedule.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "15:00" }).click();

    /*
     * 埋まっている理由が、選んでいるその場に出る（COND-001）。
     * スマホでは全画面の選択の中とフォームの両方に同じ警告が出るので、選んでいる側で確かめる。
     */
    await expect(schedule.getByText("この時間帯はすでに埋まっています")).toBeVisible();
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    // 確認へ進むボタンが押せない
    await expect(page.getByRole("button", { name: "変更内容を確認する" })).toBeDisabled();
  });
});
