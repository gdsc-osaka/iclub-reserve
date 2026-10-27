import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { formatMonthDay } from "~/lib/date";
import { nextWeekAt, toDateKey, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { findReservationsOfFacility } from "../support/lookups.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * COND-030 事務局の画面と利用者の画面（`rdra/contexts/reservation-approval.md`）。
 * 方針は ADR-016（`docs/adr/016-staff-and-user-screens.md`）決定 11〜17 を参照。
 *
 * 確かめること:
 * - COND-030 (1) / ADR-016 決定 11・12: 立場は開いている画面で決まり、事務局でない人は事務局の画面を開けない。
 * - COND-030 (2) / ADR-016 決定 12〜14: 同じ人が同じ予約を操作しても、開いている画面で予約の作成・変更結果が変わる。
 * - COND-030 (4) / ADR-016 決定 16: 切り替えで、開いている画面の同じものへ移る。
 * - COND-030 (5) / ADR-016 決定 17: 通知メールのリンクは受け取る立場の画面になる。
 *
 * UC に属さない画面領域横断の仕組みなので、UC の番号ではなく `@COND-030` のタグを付けている。
 */
test.describe("COND-030 画面領域による立場の決定", { tag: "@COND-030" }, () => {
  test("事務局でない人は、両方に置く画面の事務局の URL を開けない", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: user.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: user.id,
      startAt: nextWeekAt(Weekday.Thursday, 10),
      endAt: nextWeekAt(Weekday.Thursday, 12),
    });

    await signInAs(user.id);

    const res1 = await page.goto("/staff/availability");
    expect(res1?.status()).toBe(403);

    const res2 = await page.goto(`/staff/reservations/${reservation.id}`);
    expect(res2?.status()).toBe(403);

    const res3 = await page.goto(`/staff/groups/${group.id}`);
    expect(res3?.status()).toBe(403);
  });

  test("団体に所属する事務局が自分の団体の承認済みの予約の日時を変えると、利用者の画面からは仮予約に戻り、事務局の画面からは承認済みのまま残る", async ({
    page,
    db,
    signInAs,
  }) => {
    const staff = await createUser(db, { is_staff: true });
    const group = await createGroup(db, {
      members: [{ userId: staff.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);

    const reservation1 = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: staff.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      status: ReservationStatus.Approved,
    });
    const reservation2 = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: staff.id,
      startAt: nextWeekAt(Weekday.Thursday, 10),
      endAt: nextWeekAt(Weekday.Thursday, 12),
      status: ReservationStatus.Approved,
    });

    await signInAs(staff.id);

    // 1 件目: /reservations/<ID> の「変更」から日時を変えて保存すると「仮予約」になる
    await openPage(page, `/reservations/${reservation1.id}`);
    await page.getByRole("link", { name: "変更" }).click();
    await expect(page).toHaveURL(new RegExp(`edit=${reservation1.id}`));

    const userEditPanel = page.getByRole("region", { name: "予約の変更" });
    await expect(userEditPanel).toBeVisible();

    await userEditPanel.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "13:00" }).click();
    await userEditPanel.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "15:00" }).click();

    await userEditPanel.getByRole("button", { name: "変更内容を確認する" }).click();
    const userConfirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(userConfirm).toBeVisible();
    await expect(userConfirm.getByText("仮予約", { exact: true })).toBeVisible();
    await userConfirm.getByRole("button", { name: "この内容で変更する" }).click();

    await expect(page.getByText("予約を変更しました")).toBeVisible();
    const userDetailPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(userDetailPanel.getByText("仮予約", { exact: true })).toBeVisible();

    // 2 件目: /staff/reservations/<ID> の「変更」から日時を変えて保存すると（解錠の手配を選び直す）「承認済み」のまま
    await openPage(page, `/staff/reservations/${reservation2.id}`);
    await page.getByRole("link", { name: "変更" }).click();
    await expect(page).toHaveURL(new RegExp(`edit=${reservation2.id}`));

    const staffEditPanel = page.getByRole("region", { name: "予約の変更" });
    await expect(staffEditPanel).toBeVisible();

    await staffEditPanel.getByRole("combobox", { name: "開始時刻" }).click();
    await page.getByRole("option", { name: "13:00" }).click();
    await staffEditPanel.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "15:00" }).click();

    await staffEditPanel.getByLabel("要手配").click();
    await staffEditPanel.getByRole("button", { name: "変更内容を確認する" }).click();

    const staffConfirm = page.getByRole("alertdialog", { name: "この内容で変更しますか？" });
    await expect(staffConfirm).toBeVisible();
    await expect(staffConfirm.getByText("承認済み", { exact: true })).toBeVisible();
    await staffConfirm.getByRole("button", { name: "この内容で変更する" }).click();

    await expect(page.getByText("予約を変更しました")).toBeVisible();
    const staffDetailPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(staffDetailPanel.getByText("承認済み", { exact: true })).toBeVisible();
  });

  test("事務局の画面の欄では承認済みの予約を直接作成し、利用者の画面の欄では仮予約を申請する", async ({
    page,
    db,
    signInAs,
  }) => {
    const staff = await createUser(db, { is_staff: true });
    const group = await createGroup(db, {
      members: [{ userId: staff.id, role: MembershipRole.Admin }],
    });
    const facilityStaff = await createFacility(db);
    const facilityUser = await createFacility(db);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);

    await signInAs(staff.id);

    // 1. /staff/availability から作ると状態が「承認済み」になり、切り替えは無い
    await openPage(page, `/staff/availability?facility=${facilityStaff.id}&date=${dateKey}`);
    const staffColumn = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await staffColumn
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:00 から申請` })
      .click();

    const staffPanel = page.getByRole("region", { name: "新しい予約" });
    await expect(staffPanel).toBeVisible();
    await expect(
      staffPanel.getByRole("switch", { name: "承認済みとして直接作成する" }),
    ).toHaveCount(0);

    await staffPanel.getByRole("combobox", { name: "申請元の団体" }).click();
    await page.getByRole("option", { name: group.name }).click();

    await staffPanel.getByLabel("使用人数").fill("4");
    await staffPanel.getByLabel("要手配").click();
    await staffPanel.getByRole("button", { name: "内容を確認する" }).click();

    const staffConfirm = page.getByRole("alertdialog", { name: "予約の直接作成" });
    await expect(staffConfirm).toBeVisible();
    await expect(staffConfirm.getByText("承認済み", { exact: true })).toBeVisible();
    await staffConfirm.getByRole("button", { name: "承認済みで作成する" }).click();

    await expect(page.getByText("承認済みの予約を作成しました")).toBeVisible();
    const staffReservationPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(staffReservationPanel.getByText("承認済み", { exact: true })).toBeVisible();

    const [createdDirect] = await findReservationsOfFacility(db, facilityStaff.id);
    expect(createdDirect?.status).toBe(ReservationStatus.Approved);

    // 2. /availability から作ると「仮予約」になり、切り替えは無い
    await openPage(page, `/availability?facility=${facilityUser.id}&date=${dateKey}`);
    const userColumn = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await userColumn
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:00 から申請` })
      .click();

    const userPanel = page.getByRole("region", { name: "新しい予約" });
    await expect(userPanel).toBeVisible();
    await expect(userPanel.getByRole("switch", { name: "承認済みとして直接作成する" })).toHaveCount(
      0,
    );

    await userPanel.getByLabel("使用人数").fill("4");
    await userPanel.getByRole("button", { name: "内容を確認する" }).click();

    const userConfirm = page.getByRole("alertdialog", { name: "この内容で申請しますか？" });
    await expect(userConfirm).toBeVisible();
    await expect(userConfirm.getByText("仮予約", { exact: true })).toBeVisible();
    await userConfirm.getByRole("button", { name: "この内容で申請する" }).click();

    await expect(page.getByText("仮予約を申請しました")).toBeVisible();
    const userReservationPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(userReservationPanel.getByText("仮予約", { exact: true })).toBeVisible();

    const [createdProvisional] = await findReservationsOfFacility(db, facilityUser.id);
    expect(createdProvisional?.status).toBe(ReservationStatus.Provisional);
  });

  test("切り替えで、開いている画面の同じものへ移る", async ({ page, db, signInAs }) => {
    const staff = await createUser(db, { is_staff: true });
    const group = await createGroup(db, {
      members: [{ userId: staff.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    const day = toDateKey(nextWeekAt(Weekday.Wednesday, 0));
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: staff.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
    });

    await signInAs(staff.id);

    // 1. 事務局で /reservations/<ID> を開き、切り替えの「事務局」を押すと /staff/reservations/<ID> に移る
    await openPage(page, `/reservations/${reservation.id}`);
    const switcher1 = page.getByRole("navigation", { name: "表示する画面" });
    await switcher1.getByRole("link", { name: /^事務局/ }).click();
    await expect(page).toHaveURL(`/staff/reservations/${reservation.id}`);

    // 2. /staff/availability?facility=<ID>&date=<日付> を開き、切り替えの「利用者」を押すと /availability?facility=<ID>&date=<日付> に移る
    await openPage(page, `/staff/availability?facility=${facility.id}&date=${day}`);
    const switcher2 = page.getByRole("navigation", { name: "表示する画面" });
    await switcher2.getByRole("link", { name: /^利用者/ }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/availability");
    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("facility")).toBe(facility.id);
    expect(currentUrl.searchParams.get("date")).toBe(day);
    expect(currentUrl.searchParams.has("draft")).toBe(false);
    expect(currentUrl.searchParams.has("reservation")).toBe(false);
    expect(currentUrl.searchParams.has("edit")).toBe(false);
  });

  test("通知メールの予約の詳細へのリンクは、事務局の宛先には事務局の画面、団体側の宛先には利用者の画面になる", async ({
    page,
    db,
    signInAs,
  }) => {
    const applicant = await createUser(db, { is_staff: false });
    const staff = await createUser(db, { is_staff: true });
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    await signInAs(applicant.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await column
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:30 から申請` })
      .click();

    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();

    await panel.getByLabel("使用人数").fill("4");
    await panel.getByRole("button", { name: "内容を確認する" }).click();

    const confirm = page.getByRole("alertdialog", { name: "この内容で申請しますか？" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "この内容で申請する" }).click();

    await expect(page.getByText("仮予約を申請しました")).toBeVisible();

    const [reservation] = await findReservationsOfFacility(db, facility.id);
    expect(reservation).toBeDefined();
    expect(reservation.groupId).toBe(group.id);

    // 申請者に積まれた通知には /reservations/<ID> が入り /staff/ は入らない
    const applicantMails = (await findQueuedMails(db, applicant.email)).filter((mail) =>
      mail.bodyText.includes(reservation.id),
    );
    expect(applicantMails).toHaveLength(1);
    expect(applicantMails[0]?.bodyText).toContain(`/reservations/${reservation.id}`);
    expect(applicantMails[0]?.bodyText).not.toContain("/staff/");

    // 事務局の宛先に積まれた申請の通知の本文には /staff/reservations/<ID> が入る
    const staffMails = (await findQueuedMails(db, staff.email)).filter((mail) =>
      mail.bodyText.includes(reservation.id),
    );
    expect(staffMails).toHaveLength(1);
    expect(staffMails[0]?.bodyText).toContain(`/staff/reservations/${reservation.id}`);
  });
});
