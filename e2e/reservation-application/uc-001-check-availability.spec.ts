import type { Page } from "@playwright/test";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { addDays, atTokyoTime, formatFullDate, formatMonthDay } from "~/lib/date";
import { nextWeekAt, toDateKey, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/** カレンダーの日の列。名前は日付（11月4日(水)） */
const dayColumn = (page: Page, date: Date) =>
  page.getByRole("group", { name: formatMonthDay(date) });

/**
 * その日のいちばん上（9:00）の 30 分の枠。日が並んでいるかを確かめるのに使う。
 *
 * 日の列そのものは縦に長く、箱の高さで切れるので、見えている割合が並び方と関係なく小さくなる。
 * スマホでは注意書きが出るとカレンダーが低くなるので、日付の見出しのすぐ下の枠を使う。
 */
const firstSlot = (page: Page, date: Date) =>
  dayColumn(page, date).getByRole("button", { name: `${formatMonthDay(date)} 09:00 から申請` });

/**
 * `first` から `count` 日がカレンダーに並び、その前後の日は並んでいないことを確かめる。
 *
 * 前の日は時刻の軸（sticky）の裏に一部が重なって残り、次の日は箱の端に端数で触れることがある。
 * そのため、9 割以上が見えているかどうかで分ける。
 */
async function expectShownDays(page: Page, first: Date, count: number) {
  for (let i = 0; i < count; i++) {
    await expect(firstSlot(page, addDays(first, i))).toBeInViewport({ ratio: 0.9 });
  }
  await expect(firstSlot(page, addDays(first, -1))).not.toBeInViewport({ ratio: 0.9 });
  await expect(firstSlot(page, addDays(first, count))).not.toBeInViewport({ ratio: 0.9 });
}

/**
 * UC-001 空き状況を確認する（`rdra/contexts/reservation-application.md`）
 *
 * 空き状況カレンダー（SCR-001、`/availability`）は、カレンダーの幅で並ぶ日数が変わる。
 * - パソコン: 7 日（日曜〜土曜で固定）
 * - スマホ: 3 日（基準の日から）
 * 確かめることは同じにして、並ぶ日数の違いだけを `isMobile` で分ける。
 */
test.describe("UC-001 空き状況を確認する", { tag: "@UC-001" }, () => {
  test("カレンダーに並ぶ日数と移り方", async ({ page, db, signInAs, isMobile }) => {
    const user = await createUser(db);
    const facility = await createFacility(db);
    await signInAs(user.id);

    // 来週の水曜を基準の日にして開く
    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    await openPage(page, `/availability?facility=${facility.id}&date=${toDateKey(wednesday)}`);

    // PC は来週の日曜〜土曜、スマホは来週の水曜〜金曜が並ぶ。「次へ」で並ぶ日数ぶん進む
    const first = isMobile ? wednesday : nextWeekAt(Weekday.Sunday, 0);
    const count = isMobile ? 3 : 7;
    await expectShownDays(page, first, count);

    await page.getByRole("button", { name: "次へ" }).click();
    await expectShownDays(page, addDays(first, count), count);
  });

  test("予約の内容と見せる範囲", async ({ page, db, signInAs }) => {
    // 前提: 自団体と他団体が、同じ施設の来週に 1 件ずつ予約している
    const member = await createUser(db);
    const ownGroup = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const otherApplicant = await createUser(db);
    const otherGroup = await createGroup(db, {
      members: [{ userId: otherApplicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const anotherFacility = await createFacility(db);
    await createReservation(db, {
      groupId: ownGroup.id,
      facilityId: facility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      headCount: 4,
      note: "自団体の備考",
    });
    await createReservation(db, {
      groupId: otherGroup.id,
      facilityId: facility.id,
      createdBy: otherApplicant.id,
      startAt: nextWeekAt(Weekday.Thursday, 13),
      endAt: nextWeekAt(Weekday.Thursday, 15),
      status: ReservationStatus.Approved,
      headCount: 7,
      note: "他団体の備考",
    });
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    const panel = page.getByRole("region", { name: "予約の内容" });

    // 自団体の予約の帯を押すと、欄に使用人数と備考が出る
    await page.getByRole("button", { name: new RegExp(`${ownGroup.name}.*の詳細を見る`) }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("自団体", { exact: true })).toBeVisible();
    await expect(panel.getByText("4 名")).toBeVisible();
    await expect(panel.getByText("自団体の備考")).toBeVisible();

    // 閉じるボタンで欄を閉じる
    await panel.getByRole("button", { name: "閉じる" }).click();
    await expect(panel).toBeHidden();

    // 他団体の予約の帯を押すと、団体名は出るが使用人数と備考は出ず、見えない理由の文が出る（COND-008）
    await page
      .getByRole("button", { name: new RegExp(`${otherGroup.name}.*の詳細を見る`) })
      .click();
    await expect(panel.getByText(otherGroup.name)).toBeVisible();
    await expect(
      panel.getByText("使用人数と備考は、申請した団体のメンバーと事務局だけが見られます。"),
    ).toBeVisible();
    await expect(panel.getByText("7 名")).toBeHidden();
    await expect(panel.getByText("他団体の備考")).toBeHidden();

    // 別の施設に切り替えると、帯は並ばない
    const facilityTabs = page.getByRole("navigation", { name: "施設・設備の切り替え" });
    const anotherTab = facilityTabs.getByRole("link", { name: anotherFacility.name });
    await anotherTab.click();
    await expect(anotherTab).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: new RegExp(ownGroup.name) })).toBeHidden();
    await expect(page.getByRole("button", { name: new RegExp(otherGroup.name) })).toBeHidden();
  });

  test("空いている時間から申請へ進むと申請フォームが開き、戻る操作で欄が閉じる", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    // 来週の水曜の「10:30 から申請」を押す
    const slot = dayColumn(page, wednesday).getByRole("button", {
      name: `${formatMonthDay(wednesday)} 10:30 から申請`,
    });
    await slot.click();

    // 欄（名前「新しい予約」）に「10:30〜11:30（1 時間）」が出る
    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("10:30〜11:30（1 時間）")).toBeVisible();

    // 欄が開いた状態で戻ると、欄が消え、URL から draft が外れる
    await page.goBack();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(`/availability?facility=${facility.id}&date=${dateKey}`);

    // 開き直し、「この日時で申請に進む」で申請フォームを開く
    await slot.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: "この日時で申請に進む" }).click();

    // 申請フォーム（SCR-002）に、押した枠の施設・日付・開始時刻 10:30・終了時刻 11:30 が入っている
    await expect(page).toHaveURL(/\/reservations\/new\?/);

    /*
     * 施設・日付の欄は、パソコンではフォームの左側にあり、スマホでは「施設・日時」のカードから開く
     * 全画面の選択の中にある。
     */
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await expect(schedule.getByRole("combobox", { name: "施設・設備" })).toHaveText(facility.name);
    await expect(
      schedule.getByRole("button", { name: `日付 ${formatFullDate(wednesday)}` }),
    ).toBeVisible();
    await expect(schedule.getByRole("combobox", { name: "開始時刻" })).toHaveText("10:30");
    await expect(schedule.getByRole("combobox", { name: "終了時刻" })).toHaveText("11:30");
  });

  test("申請できない人には申請への導線が出ない", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await createGroup(db, {
      status: GroupStatus.Pending,
      members: [{ userId: member.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const dateKey = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    // 「まだ予約を申請できません」が出て、来週の水曜の 30 分の枠が押せない（COND-006）
    await expect(page.getByText("まだ予約を申請できません")).toBeVisible();
    await expect(
      dayColumn(page, wednesday).getByRole("button", {
        name: `${formatMonthDay(wednesday)} 10:00 から申請`,
      }),
    ).toBeDisabled();
  });

  test("事務局のダッシュボードの「今日の予約状況」に今日の予約が出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: user.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);

    await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: user.id,
      status: ReservationStatus.Approved,
      // スマホ幅の一覧は終わった予約を省くので、今日のうちに終わらない予約にする
      startAt: atTokyoTime(new Date(), 12, 0),
      endAt: atTokyoTime(new Date(), 23, 59),
    });

    await signInAs(personas.staff.id);
    await openPage(page, "/");

    // PC 幅ではタイムラインの帯に、スマホ幅では一覧の行に団体名が出る（もう片方は隠れている）
    const section = page.getByRole("region", { name: "今日の予約状況" });
    await expect(section.getByText(group.name).filter({ visible: true })).toBeVisible();
  });
});
