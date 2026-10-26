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
import { expect, personas, test } from "../support/fixtures.js";
import { findReservationsOfFacility } from "../support/lookups.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-002 仮予約を申請する（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-002 仮予約を申請する", { tag: "@UC-002" }, () => {
  test("欄から申請する（主な流れ）", async ({ page, db, signInAs }) => {
    // 前提: 有効な団体の一般メンバー（団体は 1 つ）と、ほかの予約が入っていない施設
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    // 来週の水曜の「10:30 から申請」を押す
    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await column
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:30 から申請` })
      .click();

    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();

    // 欄の「終了時刻」で 12:00 を選ぶ
    await panel.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "12:00" }).click();

    // 使用人数 4
    await panel.getByLabel("使用人数").fill("4");

    // 「内容を確認する」
    await panel.getByRole("button", { name: "内容を確認する" }).click();

    // 確認のダイアログ（「この内容で申請しますか？」）に「10:30〜12:00（1 時間 30 分）」が出る
    const confirm = page.getByRole("alertdialog", { name: "この内容で申請しますか？" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("10:30〜12:00（1 時間 30 分）")).toBeVisible();

    // 「この内容で申請する」
    await confirm.getByRole("button", { name: "この内容で申請する" }).click();

    // トースト「仮予約を申請しました」が出る
    await expect(page.getByText("仮予約を申請しました")).toBeVisible();

    // 欄が「予約の内容」に変わり「仮予約」が出る。URL には reservation があり draft が無い
    const reservationPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(reservationPanel).toBeVisible();
    await expect(reservationPanel.getByText("仮予約", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/facility=[^&]+&date=[^&]+&reservation=/);
    expect(page.url()).not.toContain("draft");

    // ここで戻る操作をすると、仮の枠の欄は開き直さず、欄の無いカレンダーに戻る（ADR-014 決定 10）
    await page.goBack();
    await expect(page.getByRole("region", { name: "新しい予約" })).toBeHidden();
    await expect(page.getByRole("region", { name: "予約の内容" })).toBeHidden();
    expect(page.url()).not.toContain("reservation");
    expect(page.url()).not.toContain("draft");

    // 予約一覧に仮予約として並ぶ
    await openPage(page, "/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await expect(row).toBeVisible();
    await expect(row.getByText("仮予約", { exact: true })).toBeVisible();

    // 事務局への通知（EVT-001）が積まれている
    const [reservation] = await findReservationsOfFacility(db, facility.id);
    const mails = await findQueuedMails(db, personas.staff.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約が申請されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);
  });

  test("承認済みと重なる時間は申請できない（代表的な失敗）", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);

    // 他団体の承認済みの予約が来週の水曜の 10:00〜12:00 にある
    const otherApplicant = await createUser(db);
    const otherGroup = await createGroup(db, {
      members: [{ userId: otherApplicant.id, role: MembershipRole.Member }],
    });
    await createReservation(db, {
      groupId: otherGroup.id,
      facilityId: facility.id,
      createdBy: otherApplicant.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    // 「09:00 から申請」を押す（9:00〜10:00 の仮の枠になる）
    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await column
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 09:00 から申請` })
      .click();

    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();

    // 「終了時刻」で 11:00 を選ぶ
    await panel.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "11:00" }).click();

    // 「この時間帯はすでに埋まっています」が出て、「内容を確認する」が押せない
    await expect(panel.getByText("この時間帯はすでに埋まっています")).toBeVisible();
    await expect(panel.getByRole("button", { name: "内容を確認する" })).toBeDisabled();

    // 予約は増えていない
    expect(await findReservationsOfFacility(db, facility.id)).toHaveLength(1);
  });

  test("ナビの入口から欄を開ける", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    // 施設は、このテストの中で 1 つ作っておく（施設が 1 つも無いとカレンダーが開けない）
    await createFacility(db);
    await signInAs(member.id);

    const todayKey = toDateKey(new Date());

    // 一般メンバーで予約一覧（/reservations）を開き、見えている「予約を申請」を押す
    await openPage(page, "/reservations");
    await page
      .getByRole("link", { name: "予約を申請", exact: true })
      .filter({ visible: true })
      .click();

    // 空き状況カレンダーに移り（URL は /availability?date=<今日>&draft=<今日> の形）
    await expect(page).toHaveURL(
      new RegExp(`/availability\\?.*date=${todayKey}.*draft=${todayKey}`),
    );

    // 欄「新しい予約」に「時刻を選んでいないとき」の文言が出て、「内容を確認する」が押せない
    const memberPanel = page.getByRole("region", { name: "新しい予約" });
    await expect(memberPanel).toBeVisible();
    await expect(
      memberPanel.getByText(
        "カレンダーの空いている時間を押すか、開始時刻と終了時刻を選んでください。",
      ),
    ).toBeVisible();
    await expect(memberPanel.getByRole("button", { name: "内容を確認する" })).toBeDisabled();

    // 事務局では「予約を作成」で同じ欄が開き、直接作成の切り替えが出る
    const staff = await createUser(db, { is_staff: true });
    await signInAs(staff.id);

    await openPage(page, "/reservations");
    await page
      .getByRole("link", { name: "予約を作成", exact: true })
      .filter({ visible: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/availability\\?.*date=${todayKey}.*draft=${todayKey}`),
    );
    const staffPanel = page.getByRole("region", { name: "新しい予約" });
    await expect(staffPanel).toBeVisible();
    await expect(
      staffPanel.getByText(
        "カレンダーの空いている時間を押すか、開始時刻と終了時刻を選んでください。",
      ),
    ).toBeVisible();
    await expect(
      staffPanel.getByRole("switch", { name: "承認済みとして直接作成する" }),
    ).toBeVisible();
  });

  test("丸で伸び縮みでき、PC ではなぞって選べる", async ({ page, db, signInAs, isMobile }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });

    // 「10:00 から申請」を押す（10:00〜11:00）
    const slot1000 = column.getByRole("button", {
      name: `${formatMonthDay(wednesday)} 10:00 から申請`,
    });
    await slot1000.scrollIntoViewIfNeeded();
    await slot1000.click();

    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel.getByRole("combobox", { name: "終了時刻" })).toHaveText("11:00");

    // 終了の丸（[data-slot="draft-end-handle"]）をマウスで「12:00 から申請」の枠の上端まで動かす
    const endHandle = page.locator('[data-slot="draft-end-handle"]');
    await endHandle.scrollIntoViewIfNeeded();

    const slot1200 = column.getByRole("button", {
      name: `${formatMonthDay(wednesday)} 12:00 から申請`,
    });

    const handleBox = await endHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const slot1200Box = await slot1200.boundingBox();
    expect(slot1200Box).not.toBeNull();

    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down({ button: "left" });
    await page.mouse.move(slot1200Box!.x + slot1200Box!.width / 2, slot1200Box!.y + 1, {
      steps: 5,
    });
    await page.mouse.up({ button: "left" });

    // 欄の「終了時刻」が 12:00 になる
    await expect(panel.getByRole("combobox", { name: "終了時刻" })).toHaveText("12:00");

    // PC だけ（isMobile のときはここで終える）
    if (isMobile) return;

    // 続けて「14:00 から申請」の枠から「15:30 から申請」の枠までマウスでなぞる
    const slot1400 = column.getByRole("button", {
      name: `${formatMonthDay(wednesday)} 14:00 から申請`,
    });
    const slot1530 = column.getByRole("button", {
      name: `${formatMonthDay(wednesday)} 15:30 から申請`,
    });
    await slot1530.scrollIntoViewIfNeeded();
    await slot1400.scrollIntoViewIfNeeded();
    const box1400 = await slot1400.boundingBox();
    const box1530 = await slot1530.boundingBox();
    expect(box1400).not.toBeNull();
    expect(box1530).not.toBeNull();

    await page.mouse.move(box1400!.x + box1400!.width / 2, box1400!.y + box1400!.height / 2);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(box1530!.x + box1530!.width / 2, box1530!.y + box1530!.height / 2, {
      steps: 5,
    });
    await page.mouse.up({ button: "left" });

    // 欄の時刻が 14:00〜16:00 になる
    await expect(panel.getByRole("combobox", { name: "開始時刻" })).toHaveText("14:00");
    await expect(panel.getByRole("combobox", { name: "終了時刻" })).toHaveText("16:00");
  });
});
