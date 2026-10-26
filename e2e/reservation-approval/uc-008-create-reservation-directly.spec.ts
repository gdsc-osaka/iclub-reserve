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
 * UC-008 予約を直接作成する（`rdra/contexts/reservation-approval.md`）
 */
test.describe("UC-008 予約を直接作成する", { tag: "@UC-008" }, () => {
  test("事務局が空き状況カレンダーから直接作成を選んで送信すると、最初から承認済みとして作られメールは送られない", async ({
    page,
    db,
    signInAs,
    isMobile,
  }) => {
    // 前提: 有効な団体と施設
    const applicant = await createUser(db);
    await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    await signInAs(personas.staff.id);

    // 空き状況カレンダーを開く
    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const day = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${day}`);

    // PC・スマホとも、来週の水曜の「10:00 から申請」を押す
    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await column
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:00 から申請` })
      .click();

    // 欄の「承認済みで直接作成」をクリック
    const panel = page.getByRole("region", { name: "新しい予約" });
    await panel.getByRole("link", { name: "承認済みで直接作成" }).click();

    // 申請フォームへ遷移し、直接作成スイッチがオンになっている
    await expect(page).toHaveURL(/mode=direct/);
    const directSwitch = page.getByRole("switch", { name: "承認済みとして直接作成する" });
    await expect(directSwitch).toBeVisible();
    await expect(directSwitch).toBeChecked();

    /*
     * 時間帯が 10:00〜11:00 で入っていることを確かめる。
     * PC ではフォームの右側にあり、スマホでは「施設・日時」のカードから開く
     * 全画面の選択の中にある。
     */
    if (isMobile) await page.getByRole("button", { name: /施設・日時/ }).click();
    const schedule = isMobile ? page.getByRole("dialog", { name: "施設・日時を選ぶ" }) : page;
    await expect(schedule.getByRole("combobox", { name: "開始時刻" })).toHaveText("10:00");
    await expect(schedule.getByRole("combobox", { name: "終了時刻" })).toHaveText("11:00");
    if (isMobile) await schedule.getByRole("button", { name: "決定" }).click();

    await page.getByLabel("使用人数").fill("5");
    await page.getByLabel("備考").fill("事務局の直接作成テスト");

    // 確認へ進む
    await page.getByRole("button", { name: "内容を確認する" }).click();

    // 確認ダイアログが直接作成向けになっている
    const confirm = page.getByRole("alertdialog", { name: "予約の直接作成" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("承認済み", { exact: true })).toBeVisible();
    await confirm.getByRole("button", { name: "承認済みで作成する" }).click();

    // 完了画面で承認済みとして作成されたことが表示される
    await expect(page.getByText("承認済みの予約を作成しました")).toBeVisible();
    await expect(page.getByText("承認済み", { exact: true })).toBeVisible();

    // DB 上でステータスが最初から Approved になっている
    const [reservation] = await findReservationsOfFacility(db, facility.id);
    expect(reservation).toBeDefined();
    expect(reservation.status).toBe(ReservationStatus.Approved);
    expect(reservation.headCount).toBe(5);

    /*
     * 直接作成ではメールを積まない（UC-008 のイベントは Google Calendar への登録だけ）。
     * 事務局のアカウントはほかのテストと共有していて、別の予約の通知も届いているので、
     * 本文に入る予約 ID で、この予約の通知だけに絞って数える。
     */
    const mailsOfReservation = async (to: string) =>
      (await findQueuedMails(db, to)).filter((mail) => mail.bodyText.includes(reservation.id));
    expect(await mailsOfReservation(applicant.email)).toHaveLength(0);
    expect(await mailsOfReservation(personas.staff.email)).toHaveLength(0);
  });

  test("一般ユーザーには直接作成のスイッチが表示されない（権限の境目）", async ({
    page,
    db,
    signInAs,
  }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);

    await signInAs(member.id);

    const day = toDateKey(nextWeekAt(Weekday.Wednesday, 0));
    await openPage(page, `/reservations/new?facility=${facility.id}&date=${day}&mode=direct`);

    // mode=direct を URL に指定しても、一般ユーザーにはスイッチが出ない
    await expect(page.getByRole("switch", { name: "承認済みとして直接作成する" })).toBeHidden();
  });

  test("承認済みの予約と重なる時間は直接作成できず、埋まっている理由が出る（COND-001）", async ({
    page,
    db,
    signInAs,
  }) => {
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    // 既に承認済みの予約が存在する
    await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);

    // 重複する時間帯で申請フォームを開く
    const day = toDateKey(nextWeekAt(Weekday.Wednesday, 0));
    await openPage(
      page,
      `/reservations/new?facility=${facility.id}&date=${day}&start=10:00&mode=direct`,
    );

    await page.getByLabel("使用人数").fill("4");

    // 埋まっている理由が出て、確認に進むボタンが押せない
    await expect(page.getByText("この時間帯はすでに埋まっています")).toBeVisible();
    await expect(page.getByRole("button", { name: "内容を確認する" })).toBeDisabled();

    // 予約は増えていない
    expect(await findReservationsOfFacility(db, facility.id)).toHaveLength(1);
  });
});
