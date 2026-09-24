import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, toDateKey, Weekday } from "../support/dates.js";
import { createFacility, createGroup, createUser } from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { findReservationsOfFacility } from "../support/lookups.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-002 仮予約を申請する（`rdra/contexts/reservation-application.md`）
 */
test.describe("UC-002 仮予約を申請する", { tag: "@UC-002" }, () => {
  test("一般メンバーが申請すると仮予約として作られ、自団体の一覧に出る。事務局への通知が積まれる", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    // 前提: 有効な団体の一般メンバーと、ほかの予約が入っていない施設
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);
    await signInAs(member.id);

    // 空き状況カレンダーで枠を押したときと同じく、施設・日付・開始時刻を渡して申請フォームを開く
    const day = toDateKey(nextWeekAt(Weekday.Wednesday, 0));
    await openPage(page, `/reservations/new?facility=${facility.id}&date=${day}&start=10:00`);

    /*
     * 時刻の欄は、PC ではフォームの右側にあり、スマホでは「施設・日時」のカードから開く
     * 全画面の選択の中にある。選択肢の一覧はどちらでもページの末尾に出るので、`page` から探す。
     */
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;

    await expect(schedule.getByRole("combobox", { name: "開始時刻" })).toHaveText("10:00");
    await schedule.getByRole("combobox", { name: "終了時刻" }).click();
    await page.getByRole("option", { name: "12:00" }).click();
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    await page.getByLabel("使用人数").fill("4");

    // 申請のボタンはすぐには送らず、内容の確認を挟む
    await page.getByRole("button", { name: "内容を確認する" }).click();
    const confirm = page.getByRole("alertdialog", { name: "この内容で申請しますか？" });
    await expect(confirm.getByText("10:00〜12:00（2 時間）")).toBeVisible();
    await confirm.getByRole("button", { name: "この内容で申請する" }).click();

    // 申請できたことと、仮予約になったことが画面に出る
    await expect(page.getByText("仮予約を申請しました")).toBeVisible();

    // 自団体の予約一覧に、仮予約として並ぶ
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
});
