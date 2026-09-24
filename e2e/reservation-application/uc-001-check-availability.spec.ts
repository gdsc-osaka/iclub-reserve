import type { Locator, Page } from "@playwright/test";
import { formatFullDate, formatMonthDay } from "~/lib/date";
import { GroupStatus } from "~/domain/group";
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
 * UC-001 空き状況を確認する（`rdra/contexts/reservation-application.md`）
 *
 * 空き状況カレンダー（SCR-001、`/availability`）は、画面の幅で並べ方が変わる。
 * - パソコンの幅: 週の表。予約は帯になり、押すと吹き出しに中身が出る。空いている 1 時間ごとの枠から申請へ進める
 * - スマホの幅: 日ごとの一覧。予約の中身ははじめから出ている。日付ごとの「＋」から申請へ進める（時刻はフォームで選ぶ）
 * 確かめることは同じにして、操作だけを `isMobile` で分ける。
 */

/**
 * 空き状況に並んだ予約の中身を出し、その範囲を返す。
 *
 * @param label パソコンの帯のボタンの名前に含まれる「団体名 状態」
 */
async function showReservation(
  page: Page,
  isMobile: boolean,
  groupName: string,
  label: string,
): Promise<Locator> {
  if (isMobile) {
    // 日の行も中に団体名を含むので、見出しを持たない予約の行だけを選ぶ
    return page
      .getByRole("listitem")
      .filter({ hasText: groupName })
      .filter({ hasNot: page.getByRole("heading") });
  }
  // 予約の帯は「時間 団体名 状態 の詳細を見る」という名前のボタンになっている
  await page.getByRole("button", { name: new RegExp(label) }).click();
  return page.getByRole("dialog");
}

/** パソコンの吹き出しを閉じる。スマホの一覧は開いたものが無いので、何もしない */
async function closeReservation(page: Page, isMobile: boolean) {
  if (!isMobile) {
    await page.keyboard.press("Escape");
  }
}
test.describe("UC-001 空き状況を確認する", { tag: "@UC-001" }, () => {
  test("施設と週を切り替えるとその週の予約が並び、他団体の予約は人数と備考が見えない", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
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

    // 施設を選び、来週へ進む。
    // 「次の週」のリンクは表示中の施設を指すので、施設の切り替えが終わってから押す
    await openPage(page, "/availability");
    const facilityTabs = page.getByRole("navigation", { name: "施設・設備の切り替え" });
    const facilityTab = facilityTabs.getByRole("link", { name: facility.name });
    await facilityTab.click();
    await expect(facilityTab).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "次の週" }).click();
    const nextWeekLabel = page.getByText(formatFullDate(nextWeekAt(Weekday.Sunday, 0)));
    await expect(nextWeekLabel).toBeVisible();

    // 自団体の予約は、使用人数と備考まで見られる
    const ownDetail = await showReservation(
      page,
      isMobile,
      ownGroup.name,
      `${ownGroup.name} 仮予約`,
    );
    await expect(ownDetail.getByText("自団体", { exact: true })).toBeVisible();
    await expect(ownDetail.getByText("4 名")).toBeVisible();
    await expect(ownDetail.getByText("自団体の備考")).toBeVisible();
    await closeReservation(page, isMobile);

    // 他団体の予約は、団体名・日時・状態まで。使用人数と備考は見えない（COND-008）
    const otherDetail = await showReservation(
      page,
      isMobile,
      otherGroup.name,
      `${otherGroup.name} 承認済み`,
    );
    await expect(otherDetail.getByText(otherGroup.name)).toBeVisible();
    if (!isMobile) {
      // パソコンの吹き出しには、見えない理由も書いてある
      await expect(
        otherDetail.getByText("使用人数と備考は、申請した団体のメンバーと事務局だけが見られます。"),
      ).toBeVisible();
    }
    await expect(otherDetail.getByText("7 名")).toBeHidden();
    await expect(otherDetail.getByText("他団体の備考")).toBeHidden();
    await closeReservation(page, isMobile);

    // 別の施設に切り替えると、同じ週のまま、この施設の予約は並ばなくなる
    const anotherTab = facilityTabs.getByRole("link", { name: anotherFacility.name });
    await anotherTab.click();
    await expect(anotherTab).toHaveAttribute("aria-current", "page");
    await expect(nextWeekLabel).toBeVisible();
    await expect(page.getByText(ownGroup.name)).toBeHidden();
    await expect(page.getByText(otherGroup.name)).toBeHidden();
  });

  test("空いている枠から申請へ進むと、施設・日付（パソコンでは開始時刻も）が入った申請フォームが開く", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);
    await signInAs(member.id);

    const day = nextWeekAt(Weekday.Wednesday, 0);
    await openPage(page, `/availability?facility=${facility.id}`);
    await page.getByRole("link", { name: "次の週" }).click();

    if (isMobile) {
      // スマホでは、来週水曜の「＋」を押す。時刻は申請フォームで選ぶ
      await page.getByRole("button", { name: `${formatMonthDay(day)} の仮予約を申請` }).click();
    } else {
      // パソコンでは、来週水曜の 10:00 の枠を押す
      await page
        .getByRole("button", { name: `${formatMonthDay(day)} 10:00 から仮予約を申請` })
        .click();
    }
    // 吹き出しから申請へ進む
    await page.getByRole("dialog").getByRole("link", { name: "仮予約を申請" }).click();

    // 申請フォーム（SCR-002）に、押した枠の施設・日付（パソコンでは開始時刻も）が入っている
    await expect(page).toHaveURL(/\/reservations\/new\?/);

    /*
     * 施設・日付の欄は、パソコンではフォームの左側にあり、スマホでは「施設・日時」のカードから開く
     * 全画面の選択の中にある。
     */
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await expect(schedule.getByRole("combobox", { name: "施設・設備" })).toHaveText(facility.name);
    await expect(
      schedule.getByRole("button", { name: `日付 ${formatFullDate(day)}` }),
    ).toBeVisible();
    if (!isMobile) {
      await expect(schedule.getByRole("combobox", { name: "開始時刻" })).toHaveText("10:00");
    }
  });

  test("承認待ちの団体にしか入っていない人には、申請への導線が出ない", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    const member = await createUser(db);
    await createGroup(db, {
      status: GroupStatus.Pending,
      members: [{ userId: member.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    await signInAs(member.id);

    await openPage(page, `/availability?facility=${facility.id}`);

    // 申請できない理由が出て、申請のボタンは無く、空いている枠からも申請できない（COND-006）
    await expect(page.getByText("まだ予約を申請できません")).toBeVisible();
    await expect(page.getByRole("button", { name: "仮予約を申請", exact: true })).toBeHidden();
    if (isMobile) {
      // スマホでは、日ごとの一覧に日付ごとの「＋」が出ない
      await expect(page.getByText("終日空いています").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /の仮予約を申請$/ })).toHaveCount(0);
    } else {
      // パソコンでは、週の表の枠が押せない
      await expect(page.getByRole("button", { name: /から仮予約を申請$/ }).first()).toBeDisabled();
    }
  });
});
