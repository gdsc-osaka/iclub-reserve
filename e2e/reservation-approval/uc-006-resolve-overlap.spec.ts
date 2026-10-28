import { eq } from "drizzle-orm";
import { reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { OVERLAP_REASON_TEMPLATE } from "~/domain/reservation/reason-templates";
import { nextWeekAt, Weekday } from "../support/dates.js";
import type { E2eDb } from "../support/db.js";
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
 * UC-006 仮予約を承認・却下する / UC-033 全団体の予約一覧を確認する（事務局）
 * COND-031 仮予約の重なりの解決（`rdra/contexts/reservation-approval.md`）
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 前提: 同じ施設・同じ曜日に重なり合う仮予約が 3 件ある。
 * 施設を 1 つ、団体を 3 つ、申請者（一般メンバー）を各 1 人作る。
 * A: 10〜12 時、B: 11〜13 時、C: 12〜14 時。
 * 申請日時は A が最も古く、B、C の順に新しくする。
 * A と C は重ならず、B は両方と重なるため 3 件で 1 つのまとまりになる。
 */
async function createOverlappingReservations(db: E2eDb) {
  const facility = await createFacility(db);

  const applicantA = await createUser(db);
  const groupA = await createGroup(db, {
    members: [{ userId: applicantA.id, role: MembershipRole.Member }],
  });

  const applicantB = await createUser(db);
  const groupB = await createGroup(db, {
    members: [{ userId: applicantB.id, role: MembershipRole.Member }],
  });

  const applicantC = await createUser(db);
  const groupC = await createGroup(db, {
    members: [{ userId: applicantC.id, role: MembershipRole.Member }],
  });

  const timeA = new Date(Date.now() - 3 * DAY_MS);
  const timeB = new Date(Date.now() - 2 * DAY_MS);
  const timeC = new Date(Date.now() - 1 * DAY_MS);

  const reservationA = await createReservation(db, {
    groupId: groupA.id,
    facilityId: facility.id,
    createdBy: applicantA.id,
    startAt: nextWeekAt(Weekday.Thursday, 10),
    endAt: nextWeekAt(Weekday.Thursday, 12),
    createdAt: timeA,
    requestedAt: timeA,
  });

  const reservationB = await createReservation(db, {
    groupId: groupB.id,
    facilityId: facility.id,
    createdBy: applicantB.id,
    startAt: nextWeekAt(Weekday.Thursday, 11),
    endAt: nextWeekAt(Weekday.Thursday, 13),
    createdAt: timeB,
    requestedAt: timeB,
  });

  const reservationC = await createReservation(db, {
    groupId: groupC.id,
    facilityId: facility.id,
    createdBy: applicantC.id,
    startAt: nextWeekAt(Weekday.Thursday, 12),
    endAt: nextWeekAt(Weekday.Thursday, 14),
    createdAt: timeC,
    requestedAt: timeC,
  });

  return {
    facility,
    groupA,
    groupB,
    groupC,
    applicantA,
    applicantB,
    applicantC,
    reservationA,
    reservationB,
    reservationC,
  };
}

test.describe(
  "UC-006 仮予約の重なりを解決する（COND-031）",
  { tag: ["@UC-006", "@UC-033"] },
  () => {
    test("一覧のまとまりから重なりを解決すると、選んだ予約が承認され、重なる予約がまとめて却下される", async ({
      page,
      db,
      signInAs,
    }) => {
      // 事務局が一覧のまとまりから先着の予約を承認し、重なる予約が定型文の理由つきで却下され、
      // 重ならない予約は仮予約のまま残り、それぞれ通知メールが積まれることを確かめる
      const {
        facility,
        groupA,
        groupB,
        groupC,
        applicantA,
        applicantB,
        applicantC,
        reservationA,
        reservationB,
        reservationC,
      } = await createOverlappingReservations(db);

      await signInAs(personas.staff.id);
      await openPage(page, "/staff/reservations");

      // 施設の名前を含む「重なる仮予約 3 件」のまとまりが 1 つ出ている
      const groupCard = page
        .getByRole("listitem")
        .filter({ hasText: facility.name })
        .filter({ hasText: "重なる仮予約 3 件" });
      await expect(groupCard).toBeVisible();

      // 中の行のリンクの名前順で A・B・C の並びを確かめる
      const detailLinks = groupCard.getByRole("link", { name: /の予約の詳細を表示$/ });
      await expect(detailLinks).toHaveCount(3);
      const linkLabels = await Promise.all(
        (await detailLinks.all()).map((link) => link.getAttribute("aria-label")),
      );
      expect(linkLabels).toEqual([
        `10:00 – 12:00 ${groupA.name} の予約の詳細を表示`,
        `11:00 – 13:00 ${groupB.name} の予約の詳細を表示`,
        `12:00 – 14:00 ${groupC.name} の予約の詳細を表示`,
      ]);

      // A に「先着」が付いており、B・C には付いていない
      const rowA = groupCard.getByRole("listitem").filter({ hasText: groupA.name });
      const rowB = groupCard.getByRole("listitem").filter({ hasText: groupB.name });
      const rowC = groupCard.getByRole("listitem").filter({ hasText: groupC.name });
      await expect(rowA.getByText("先着", { exact: true })).toBeVisible();
      await expect(rowB.getByText("先着", { exact: true })).toBeHidden();
      await expect(rowC.getByText("先着", { exact: true })).toBeHidden();

      // まとまりの「重なりを解決」を押す
      await groupCard.getByRole("button", { name: "重なりを解決" }).click();

      // ダイアログが開き、A が選ばれ、B に「却下する」、C に「仮予約のまま」が出ている
      const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
      await expect(dialog).toBeVisible();

      const radioGroup = dialog.getByRole("radiogroup", { name: "承認する予約" });
      await expect(radioGroup.getByRole("radio", { name: groupA.name })).toBeChecked();

      const candidateA = radioGroup.locator("> div").filter({ hasText: groupA.name });
      const candidateB = radioGroup.locator("> div").filter({ hasText: groupB.name });
      const candidateC = radioGroup.locator("> div").filter({ hasText: groupC.name });

      await expect(candidateA.getByText("承認する", { exact: true })).toBeVisible();
      await expect(candidateA.getByText("先着", { exact: true })).toBeVisible();
      await expect(candidateB.getByText("却下する", { exact: true })).toBeVisible();
      await expect(candidateC.getByText("仮予約のまま", { exact: true })).toBeVisible();

      // 却下理由の欄に、初めから定型文が入っている
      const reasonField = dialog.getByLabel(/却下理由/);
      await expect(reasonField).toHaveValue(OVERLAP_REASON_TEMPLATE.text);

      // 解錠の手配で「要手配」を選び、承認を実行する
      await dialog.getByLabel("要手配").click();
      await dialog.getByRole("button", { name: "承認して 1 件を却下する" }).click();

      // ダイアログが閉じ、まとまりが一覧から消えるのを待つ
      await expect(dialog).toBeHidden();
      await expect(groupCard).toBeHidden();

      // DB の状態: A が承認済み、B が理由つきで却下済み、C が仮予約のまま
      const [savedA] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationA.id));
      expect(savedA?.status).toBe(ReservationStatus.Approved);

      const [savedB] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationB.id));
      expect(savedB?.status).toBe(ReservationStatus.Rejected);
      expect(savedB?.statusReason).toBe(OVERLAP_REASON_TEMPLATE.text);

      const [savedC] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationC.id));
      expect(savedC?.status).toBe(ReservationStatus.Provisional);

      // メール: A に承認通知 1 通、B に理由つき却下通知 1 通、C には通知がない
      const mailsA = await findQueuedMails(db, applicantA.email);
      const approvedMailsA = mailsA.filter(
        (mail) =>
          mail.subject.includes("利用予約が承認されました") &&
          mail.bodyText.includes(reservationA.id),
      );
      expect(approvedMailsA).toHaveLength(1);

      const mailsB = await findQueuedMails(db, applicantB.email);
      const rejectedMailsB = mailsB.filter(
        (mail) =>
          mail.subject.includes("利用予約が却下されました") &&
          mail.bodyText.includes(reservationB.id) &&
          mail.bodyText.includes(OVERLAP_REASON_TEMPLATE.text),
      );
      expect(rejectedMailsB).toHaveLength(1);

      const mailsC = await findQueuedMails(db, applicantC.email);
      const relatedMailsC = mailsC.filter(
        (mail) =>
          (mail.subject.includes("利用予約が承認されました") ||
            mail.subject.includes("利用予約が却下されました")) &&
          mail.bodyText.includes(reservationC.id),
      );
      expect(relatedMailsC).toHaveLength(0);
    });

    test("予約詳細の承認から開くと、押した予約が選ばれていて先着を却下する注意が出る", async ({
      page,
      db,
      signInAs,
    }) => {
      // 予約詳細の「承認」から開いたときにその予約が初期選択され、
      // 先着の予約を却下する注意が表示され、承認すると重なるすべての予約が却下されることを確かめる
      const { groupA, groupB, groupC, reservationA, reservationB, reservationC } =
        await createOverlappingReservations(db);

      await signInAs(personas.staff.id);
      await openPage(page, `/staff/reservations/${reservationB.id}`);
      await page.getByRole("button", { name: "承認" }).click();

      // ダイアログで B が選ばれており、A・C が却下対象になっている
      const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
      await expect(dialog).toBeVisible();

      const radioGroup = dialog.getByRole("radiogroup", { name: "承認する予約" });
      await expect(radioGroup.getByRole("radio", { name: groupB.name })).toBeChecked();

      const candidateA = radioGroup.locator("> div").filter({ hasText: groupA.name });
      const candidateB = radioGroup.locator("> div").filter({ hasText: groupB.name });
      const candidateC = radioGroup.locator("> div").filter({ hasText: groupC.name });

      await expect(candidateB.getByText("承認する", { exact: true })).toBeVisible();
      await expect(candidateA.getByText("却下する", { exact: true })).toBeVisible();
      await expect(candidateC.getByText("却下する", { exact: true })).toBeVisible();

      // 先着の予約を却下する注意が出ている
      await expect(
        dialog.getByText(`先に申請した${groupA.name}の予約を却下します。`),
      ).toBeVisible();

      // 解錠の手配を選んで承認する
      await dialog.getByLabel("要手配").click();
      await dialog.getByRole("button", { name: "承認して 2 件を却下する" }).click();

      // 予約詳細が承認済みになるのを待つ
      await expect(page.getByText("承認済み", { exact: true }).first()).toBeVisible();

      // DB の状態: B が承認済み、A と C が却下済み
      const [savedB] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationB.id));
      expect(savedB?.status).toBe(ReservationStatus.Approved);

      const [savedA] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationA.id));
      expect(savedA?.status).toBe(ReservationStatus.Rejected);

      const [savedC] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationC.id));
      expect(savedC?.status).toBe(ReservationStatus.Rejected);
    });

    test("ダイアログを開いた後に重ならなくなった予約は、却下しない", async ({
      page,
      db,
      signInAs,
    }) => {
      // ダイアログを開いた後に時間帯が変更されて重ならなくなった予約は、
      // まとめて却下する対象から除外され、仮予約のまま残ることを確かめる
      const { facility, groupA, groupB, applicantB, reservationA, reservationB, reservationC } =
        await createOverlappingReservations(db);

      await signInAs(personas.staff.id);
      await openPage(page, "/staff/reservations");

      const groupCard = page
        .getByRole("listitem")
        .filter({ hasText: facility.name })
        .filter({ hasText: "重なる仮予約 3 件" });
      await groupCard.getByRole("button", { name: "重なりを解決" }).click();

      const dialog = page.getByRole("alertdialog", { name: "仮予約の承認" });
      await expect(dialog).toBeVisible();

      const radioGroup = dialog.getByRole("radiogroup", { name: "承認する予約" });
      await expect(radioGroup.getByRole("radio", { name: groupA.name })).toBeChecked();
      const candidateB = radioGroup.locator("> div").filter({ hasText: groupB.name });
      await expect(candidateB.getByText("却下する", { exact: true })).toBeVisible();

      // ダイアログを開いたまま、DB で B を同じ施設の 15〜17 時に変える
      const now = new Date();
      await db
        .update(reservationTable)
        .set({
          startAt: nextWeekAt(Weekday.Thursday, 15),
          endAt: nextWeekAt(Weekday.Thursday, 17),
          updatedAt: now,
        })
        .where(eq(reservationTable.id, reservationB.id));

      // 「要手配」を選んで「承認して 1 件を却下する」を押す
      await dialog.getByLabel("要手配").click();
      await dialog.getByRole("button", { name: "承認して 1 件を却下する" }).click();

      // ダイアログが閉じ、まとまりが消えるのを待つ
      await expect(dialog).toBeHidden();
      await expect(groupCard).toBeHidden();

      // DB の状態: A が承認済み、B は仮予約のまま（理由は空）、C も仮予約のまま
      const [savedA] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationA.id));
      expect(savedA?.status).toBe(ReservationStatus.Approved);

      const [savedB] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationB.id));
      expect(savedB?.status).toBe(ReservationStatus.Provisional);
      expect(savedB?.statusReason).toBeNull();

      const [savedC] = await db
        .select()
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationC.id));
      expect(savedC?.status).toBe(ReservationStatus.Provisional);

      // B の申請者に却下の通知がない
      const mailsB = await findQueuedMails(db, applicantB.email);
      const rejectedMailsB = mailsB.filter(
        (mail) =>
          mail.subject.includes("利用予約が却下されました") &&
          mail.bodyText.includes(reservationB.id),
      );
      expect(rejectedMailsB).toHaveLength(0);
    });

    test("事務局でない人は、重なりのまとまりを読めない", async ({ page, db, signInAs }) => {
      // 事務局でない利用者が重なり解決のエンドポイントにアクセスすると、
      // 403 エラーが返ることを確かめる
      const { applicantA, reservationA } = await createOverlappingReservations(db);

      await signInAs(applicantA.id);

      const response = await page.request.get(`/staff/reservations/${reservationA.id}/overlaps`);
      expect(response.status()).toBe(403);
    });
  },
);
