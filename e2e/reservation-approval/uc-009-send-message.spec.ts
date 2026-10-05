import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import type { E2eDb } from "../support/db.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createReservationMessage,
  createUser,
  uniqueSuffix,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { findReservationMessages } from "../support/lookups.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-009 予約へのメッセージ（`rdra/contexts/reservation-approval.md`）
 *
 * 操作するのは、予約詳細画面（SCR-005、`/reservations/:reservationId`）。
 * COND-008（可視範囲と送信者表示）、COND-023（送れる時期と編集・削除の非表示）、EVT-008（通知宛先）。
 */

/** テスト用の予約と関係者（申請者・管理者・一般メンバー）を作成するヘルパー */
async function setupReservationWithMembers(db: E2eDb) {
  const applicant = await createUser(db);
  const admin = await createUser(db);
  const member = await createUser(db);

  const group = await createGroup(db, {
    members: [
      { userId: applicant.id, role: MembershipRole.Member },
      { userId: admin.id, role: MembershipRole.Admin },
      { userId: member.id, role: MembershipRole.Member },
    ],
  });

  const facility = await createFacility(db);
  const reservation = await createReservation(db, {
    groupId: group.id,
    facilityId: facility.id,
    createdBy: applicant.id,
    startAt: nextWeekAt(Weekday.Thursday, 13),
    endAt: nextWeekAt(Weekday.Thursday, 15),
  });

  return { applicant, admin, member, group, facility, reservation };
}

test.describe("UC-009 予約へのメッセージ", { tag: "@UC-009" }, () => {
  test("団体の一般メンバーが送ると欄に出て、事務局にだけ通知が積まれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, admin, member, reservation } = await setupReservationWithMembers(db);

    await signInAs(member.id);
    await openPage(page, `/reservations/${reservation.id}`);

    const messageBody = `機材の追加利用について質問があります ${uniqueSuffix()}`;

    // メッセージを入力して送信
    await page.getByLabel("メッセージを書く").fill(messageBody);
    await page.getByRole("button", { name: "メッセージを送信" }).click();

    // 送信完了トーストとメッセージ一覧の表示を確認
    await expect(page.getByText("メッセージを送信しました。")).toBeVisible();
    await expect(page.getByText(messageBody)).toBeVisible();
    const messageList = page.getByRole("list", { name: "メッセージの一覧" });
    await expect(messageList.getByText(member.name, { exact: true })).toBeVisible();

    // 入力欄が空に戻っていること
    await expect(page.getByLabel("メッセージを書く")).toHaveValue("");

    // 事務局宛てに通知メールが 1 通積まれていること
    const staffMails = await findQueuedMails(db, personas.staff.email);
    const relatedStaffMails = staffMails.filter(
      (mail) =>
        mail.subject.includes("予約にメッセージが届きました") &&
        mail.bodyText.includes(reservation.id) &&
        mail.bodyText.includes(messageBody),
    );
    expect(relatedStaffMails).toHaveLength(1);

    // 申請者・管理者宛てには、この予約の通知は積まれないこと
    const applicantMails = await findQueuedMails(db, applicant.email);
    expect(applicantMails.filter((mail) => mail.bodyText.includes(reservation.id))).toHaveLength(0);

    const adminMails = await findQueuedMails(db, admin.email);
    expect(adminMails.filter((mail) => mail.bodyText.includes(reservation.id))).toHaveLength(0);
  });

  test("事務局が返信すると、申請者・管理者・問い合わせた一般メンバーに通知が積まれ、送信者は「事務局」とだけ書かれる", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, admin, member, reservation } = await setupReservationWithMembers(db);

    // 一般メンバーの問い合わせを DB に入れておく
    const memberMessageBody = `利用当日の施錠について ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: member.id,
      body: memberMessageBody,
      sentAsStaff: false,
    });

    // 事務局でログインして予約詳細を開く
    await signInAs(personas.staff.id);
    await openPage(page, `/reservations/${reservation.id}`);

    // 一般メンバーの氏名と問い合わせが見える
    const messageList = page.getByRole("list", { name: "メッセージの一覧" });
    await expect(messageList.getByText(member.name, { exact: true })).toBeVisible();
    await expect(messageList.getByText(memberMessageBody)).toBeVisible();

    // 事務局が返信を送る
    const staffReplyBody = `施錠キーは管理室に返却してください。\nよろしくお願いいたします。 ${uniqueSuffix()}`;
    await page.getByLabel("メッセージを書く").fill(staffReplyBody);
    await page.getByRole("button", { name: "メッセージを送信" }).click();

    // 事務局側の一覧には「<氏名>（事務局）」と表示される
    await expect(page.getByText("メッセージを送信しました。")).toBeVisible();
    await expect(page.getByText(staffReplyBody)).toBeVisible();
    await expect(page.getByText(`${personas.staff.name}（事務局）`, { exact: true })).toBeVisible();

    // 申請者・管理者・問い合わせた一般メンバーの 3 人に 1 通ずつ通知が積まれる
    for (const recipient of [applicant, admin, member]) {
      const mails = await findQueuedMails(db, recipient.email);
      const matched = mails.filter(
        (mail) =>
          mail.subject.includes("予約にメッセージが届きました") &&
          mail.bodyText.includes(reservation.id) &&
          mail.bodyText.includes(staffReplyBody),
      );
      expect(matched).toHaveLength(1);
      // 送信者表示は「事務局」であり、事務局員の氏名は含まれない
      expect(matched[0].bodyText).toContain("送信者: 事務局");
      expect(matched[0].bodyText).not.toContain(personas.staff.name);
    }

    // 事務局自身にはこの返信の通知は積まれない
    const staffMails = await findQueuedMails(db, personas.staff.email);
    expect(staffMails.filter((mail) => mail.bodyText.includes(staffReplyBody))).toHaveLength(0);
  });

  test("団体側には、事務局としての送信の送信者が「事務局」とだけ出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const { applicant, reservation } = await setupReservationWithMembers(db);

    const staffMessageBody = `事務局からの案内事項です ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: personas.staff.id,
      sentAsStaff: true,
      body: staffMessageBody,
    });

    // 申請者でログインして開く
    await signInAs(applicant.id);
    await openPage(page, `/reservations/${reservation.id}`);

    // 本文が表示され、送信者ラベルは「事務局」とだけ表示される
    await expect(page.getByText(staffMessageBody)).toBeVisible();
    const messageItem = page.getByRole("listitem").filter({ hasText: staffMessageBody });
    await expect(messageItem.getByText("事務局", { exact: true })).toBeVisible();

    // ページのどこにも事務局員の氏名が出ない
    await expect(page.getByText(personas.staff.name)).toBeHidden();
  });

  test("他団体の人には、メッセージの本文も送信欄も出ない", async ({ page, db, signInAs }) => {
    const { reservation } = await setupReservationWithMembers(db);

    const secretMessageBody = `部内限定の連絡です ${uniqueSuffix()}`;
    await createReservationMessage(db, {
      reservationId: reservation.id,
      senderId: personas.staff.id,
      sentAsStaff: true,
      body: secretMessageBody,
    });

    // 他団体のユーザーを作成してログイン
    const outsider = await createUser(db);
    await createGroup(db, {
      members: [{ userId: outsider.id, role: MembershipRole.Member }],
    });

    await signInAs(outsider.id);
    await openPage(page, `/reservations/${reservation.id}`);

    // 画面は開けている（公開範囲だけの表示になっている）ことを先に確かめる。
    // これが無いと、画面が出ていないだけでも下の「出ない」が通ってしまう
    await expect(
      page.getByText(
        "他の団体の予約のため、公開されている項目（団体名・施設・日時・状態）だけを表示しています。",
      ),
    ).toBeVisible();

    // メッセージの本文も「メッセージを書く」の欄も出ない
    await expect(page.getByText(secretMessageBody)).toBeHidden();
    await expect(page.getByLabel("メッセージを書く")).toBeHidden();
  });

  test("空白と改行だけでは送れない", async ({ page, db, signInAs }) => {
    const { member, reservation } = await setupReservationWithMembers(db);

    await signInAs(member.id);
    await openPage(page, `/reservations/${reservation.id}`);

    // 空白と改行だけを入力して送信
    await page.getByLabel("メッセージを書く").fill("   \n\n   ");
    await page.getByRole("button", { name: "メッセージを送信" }).click();

    // エラーメッセージが表示される
    await expect(page.getByText("メッセージを入力してください。")).toBeVisible();

    // DB にメッセージの行が増えていないこと
    const messages = await findReservationMessages(db, reservation.id);
    expect(messages).toHaveLength(0);
  });
});
