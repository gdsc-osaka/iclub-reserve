import { eq } from "drizzle-orm";
import { reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import type { E2eDb } from "../support/db.js";
import { nextWeekAt, toDateKey, Weekday } from "../support/dates.js";
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
 * UC-006 仮予約を承認・却下する（`rdra/contexts/reservation-approval.md`）
 */

/** 前提: ある団体が申請した仮予約が 1 件ある。施設はこの予約のために作る */
async function createProvisionalReservation(db: E2eDb) {
  const applicant = await createUser(db);
  const group = await createGroup(db, {
    members: [{ userId: applicant.id, role: MembershipRole.Member }],
  });
  const facility = await createFacility(db);
  const reservation = await createReservation(db, {
    groupId: group.id,
    facilityId: facility.id,
    createdBy: applicant.id,
    startAt: nextWeekAt(Weekday.Thursday, 13),
    endAt: nextWeekAt(Weekday.Thursday, 15),
  });
  return { applicant, facility, reservation };
}

test.describe("UC-006 仮予約を承認・却下する", { tag: "@UC-006" }, () => {
  test("空き状況カレンダー（SCR-001）の欄からも承認できる", async ({ page, db, signInAs }) => {
    const { facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    const dateKey = toDateKey(reservation.startAt);
    await openPage(page, `/availability?facility=${facility.id}&date=${dateKey}`);

    // 予約の帯をクリックして欄を開く
    const reservationBlock = page.getByRole("button", { name: /詳細を見る/ });
    await reservationBlock.click();

    const panel = page.getByRole("region", { name: "予約の内容" });
    await expect(panel).toBeVisible();

    // 欄内に予約詳細リンクがあることを確認
    const detailLink = panel.getByRole("link", { name: "予約詳細を見る" });
    await expect(detailLink).toBeVisible();
    await expect(detailLink).toHaveAttribute("href", `/reservations/${reservation.id}`);

    // 欄内の承認ボタンをクリック
    await panel.getByRole("button", { name: "承認" }).click();

    // 確認ダイアログが開いていることを確認
    const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "承認する" }).click();

    /*
     * 承認の結果は、同じカレンダーに戻って帯が「承認済み」に変わったことで待つ。
     * 帯の読み上げ名には状態が入っているので、変わればこの名前で見つかる。
     * 欄は開いたまま承認済みになり、URL は facility・date・reservation を保っていることを確かめる。
     */
    await expect(page.getByRole("button", { name: /承認済み の詳細を見る/ })).toBeVisible();
    await expect(panel.getByText("承認済み", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(
      `/availability?facility=${facility.id}&date=${dateKey}&reservation=${reservation.id}`,
    );

    const [saved] = await db
      .select()
      .from(reservationTable)
      .where(eq(reservationTable.id, reservation.id));
    expect(saved?.status).toBe(ReservationStatus.Approved);
  });

  test("事務局が承認すると承認済みになり、承認の通知が積まれる", async ({ page, db, signInAs }) => {
    const { applicant, facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    // 事務局の予約一覧は、既定で仮予約だけを出す
    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "承認" }).click();

    // 確認のダイアログで承認する
    const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
    await dialog.getByRole("button", { name: "承認する" }).click();

    // 仮予約ではなくなったので、既定の一覧からは消える
    await expect(row).toBeHidden();

    // 「承認済み」に絞り込むと、承認済みとして並んでいる
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /承認済み/ })
      .click();
    await expect(row.getByText("承認済み", { exact: true })).toBeVisible();

    // 申請者への承認の通知（EVT-005）が積まれている
    const mails = await findQueuedMails(db, applicant.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約が承認されました") &&
          mail.bodyText.includes(reservation.id),
      ),
    ).toHaveLength(1);
  });

  test("事務局が理由を入れて却下すると却下済みになり、理由つきの却下の通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "却下" }).click();

    const dialog = page.getByRole("alertdialog", { name: "仮予約の却下" });
    await dialog.getByLabel(/却下理由/).fill("同じ時間に学内行事があるため");
    await dialog.getByRole("button", { name: "却下する" }).click();

    // 仮予約ではなくなったので、既定の一覧からは消える
    await expect(row).toBeHidden();

    // 「キャンセル・却下」に絞り込むと、却下済みとして並んでいる
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /キャンセル・却下/ })
      .click();
    await expect(row.getByText("却下済み", { exact: true })).toBeVisible();

    // 申請者への却下の通知（EVT-006）が、理由つきで積まれている
    const mails = await findQueuedMails(db, applicant.email);
    expect(
      mails.filter(
        (mail) =>
          mail.subject.includes("利用予約が却下されました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes("同じ時間に学内行事があるため"),
      ),
    ).toHaveLength(1);
  });

  test("理由を入れないと却下できない", async ({ page, db, signInAs }) => {
    const { facility, reservation } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);

    await openPage(page, "/staff/reservations");
    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "却下" }).click();

    // 理由が空や空白だけのうちは、却下のボタンを押せない（COND-002）
    const dialog = page.getByRole("alertdialog", { name: "仮予約の却下" });
    const rejectButton = dialog.getByRole("button", { name: "却下する" });
    await expect(rejectButton).toBeDisabled();
    await dialog.getByLabel(/却下理由/).fill("   ");
    await expect(rejectButton).toBeDisabled();

    // 予約は仮予約のまま
    const [saved] = await db
      .select()
      .from(reservationTable)
      .where(eq(reservationTable.id, reservation.id));
    expect(saved?.status).toBe(ReservationStatus.Provisional);
  });

  test("ダッシュボード（SCR-022）の承認待ちから、その場で仮予約を承認できる", async ({
    page,
    db,
    signInAs,
  }) => {
    /*
     * ダッシュボードには開始の近い 5 件しか出ないので、ほかのテストが残した仮予約より
     * 先に始まるよう、1 時間後に始まる予約にする
     */
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    const startAt = new Date(Date.now() + 60 * 60 * 1000);
    const reservation = await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
    });

    await signInAs(personas.staff.id);
    await openPage(page, "/");

    const section = page.getByRole("region", { name: "承認待ちの予約" });
    const row = section.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "承認" }).click();

    // 確認のダイアログを挟まずに承認され、行が一覧から消える
    await expect(row).toBeHidden();
    await expect
      .poll(async () => {
        const [saved] = await db
          .select()
          .from(reservationTable)
          .where(eq(reservationTable.id, reservation.id));
        return saved?.status;
      })
      .toBe(ReservationStatus.Approved);
  });

  test("事務局が承認すると、ナビの「予約の承認」の件数が 1 つ減る", async ({
    page,
    db,
    signInAs,
  }) => {
    // ほかのテストが残した仮予約もあるので、件数は決め打ちせず、承認の前後の差で確かめる
    const { facility } = await createProvisionalReservation(db);

    await signInAs(personas.staff.id);
    await openPage(page, "/staff/reservations");

    // PC ではサイドバー、スマホではボトムバーの項目が見えている。件数は「予約の承認（3 件）」のようにリンクの名前に入る
    const navLink = page.getByRole("link", { name: /^予約の承認/ });
    const before = Number((await navLink.textContent())?.match(/（(\d+) 件）/)?.[1]);
    expect(before).toBeGreaterThanOrEqual(1);

    const row = page.getByRole("listitem").filter({ hasText: facility.name });
    await row.getByRole("button", { name: "承認" }).click();
    await page
      .getByRole("alertdialog", { name: "仮予約の承認" })
      .getByRole("button", { name: "承認する" })
      .click();
    await expect(row).toBeHidden();

    /*
     * 承認（GET 以外の送信）のあとに数え直される。0 件になったら件数は出さない。
     * 読み上げ用の「（N 件）」は画面外に置いた要素なので、名前の計算では前に空白が入る
     */
    await expect(navLink).toHaveAccessibleName(
      before === 1 ? "予約の承認" : new RegExp(`^予約の承認\\s*（${before - 1} 件）$`),
    );
  });
});
