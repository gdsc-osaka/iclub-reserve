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
  test("欄から直接作成する（主な流れ）", async ({ page, db, signInAs }) => {
    // 前提: 有効な団体と施設
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    await signInAs(personas.staff.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const day = toDateKey(wednesday);
    await openPage(page, `/availability?facility=${facility.id}&date=${day}`);

    // 来週の水曜の「10:00 から申請」を押す
    const column = page.getByRole("group", { name: formatMonthDay(wednesday) });
    await column
      .getByRole("button", { name: `${formatMonthDay(wednesday)} 10:00 から申請` })
      .click();

    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();

    // 欄の「申請元の団体」で、このテストで作った団体を選ぶ
    await panel.getByRole("combobox", { name: "申請元の団体" }).click();
    await page.getByRole("option", { name: group.name }).click();

    // 「承認済みとして直接作成する」をオン
    await panel.getByRole("switch", { name: "承認済みとして直接作成する" }).click();

    // 使用人数 5・備考
    await panel.getByLabel("使用人数").fill("5");
    await panel.getByLabel("備考").fill("事務局の直接作成テスト");

    // 「内容を確認する」
    await panel.getByRole("button", { name: "内容を確認する" }).click();

    // 確認のダイアログ（「予約の直接作成」）に「承認済み」が出る
    const confirm = page.getByRole("alertdialog", { name: "予約の直接作成" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("承認済み", { exact: true })).toBeVisible();

    // 「承認済みで作成する」
    await confirm.getByRole("button", { name: "承認済みで作成する" }).click();

    // トースト「承認済みの予約を作成しました」が出る
    await expect(page.getByText("承認済みの予約を作成しました")).toBeVisible();

    // 欄が「予約の内容」に変わり「承認済み」が出る
    const reservationPanel = page.getByRole("region", { name: "予約の内容" });
    await expect(reservationPanel).toBeVisible();
    await expect(reservationPanel.getByText("承認済み", { exact: true })).toBeVisible();

    // DB 上でステータスが最初から Approved になっている
    const [reservation] = await findReservationsOfFacility(db, facility.id);
    expect(reservation).toBeDefined();
    expect(reservation.status).toBe(ReservationStatus.Approved);
    expect(reservation.groupId).toBe(group.id);
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

  test("一般ユーザーには切り替えが出ない（権限の境目）", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Member }] });
    const facility = await createFacility(db);

    await signInAs(member.id);

    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const day = toDateKey(wednesday);
    await openPage(
      page,
      `/availability?facility=${facility.id}&date=${day}&draft=${day}T10:00-11:00`,
    );

    // 欄「新しい予約」は出るが、「承認済みとして直接作成する」は出ない
    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("switch", { name: "承認済みとして直接作成する" })).toBeHidden();
  });

  test("承認済みと重なる時間は直接作成できない（COND-001）", async ({ page, db, signInAs }) => {
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);

    // 承認済みの予約が 10:00〜12:00 にある
    await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);

    // 事務局で同じ形の URL（10:00〜11:00 の仮の枠）を開く
    const wednesday = nextWeekAt(Weekday.Wednesday, 0);
    const day = toDateKey(wednesday);
    await openPage(
      page,
      `/availability?facility=${facility.id}&date=${day}&draft=${day}T10:00-11:00`,
    );

    // 「この時間帯はすでに埋まっています」が出て、「内容を確認する」が押せない
    const panel = page.getByRole("region", { name: "新しい予約" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("この時間帯はすでに埋まっています")).toBeVisible();
    await expect(panel.getByRole("button", { name: "内容を確認する" })).toBeDisabled();

    // 予約は増えていない
    expect(await findReservationsOfFacility(db, facility.id)).toHaveLength(1);
  });
});
