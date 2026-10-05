import { describe, expect, it } from "vitest";

import { formatDateTime } from "~/lib/date";
import type { ReservationMessage } from "../reservation/message";
import {
  createReservationMessageMailDrafts,
  selectReservationMessageRecipients,
  type ReservationMessageAudience,
} from "./reservation-message-mail";

const userApplicant = {
  userId: "usr_applicant",
  address: "applicant@ecs.osaka-u.ac.jp",
  name: "申請者",
};
const userAdmin = {
  userId: "usr_admin",
  address: "admin@ecs.osaka-u.ac.jp",
  name: "団体管理者",
};
const userPriorSender = {
  userId: "usr_prior",
  address: "prior@ecs.osaka-u.ac.jp",
  name: "過去送信者",
};
const userStaff1 = {
  userId: "usr_staff1",
  address: "staff1@osaka-u.ac.jp",
  name: "事務局1",
};
const userStaff2 = {
  userId: "usr_staff2",
  address: "staff2@osaka-u.ac.jp",
  name: "事務局2",
};
// 団体の管理者を兼ねている事務局員
const userStaffAdmin = {
  userId: "usr_staff_admin",
  address: "staff_admin@osaka-u.ac.jp",
  name: "事務局兼管理者",
};

const audience: ReservationMessageAudience = {
  groupMembers: [userApplicant, userAdmin, userStaffAdmin],
  staff: [userStaff1, userStaff2, userStaffAdmin],
  priorGroupSideSenders: [userPriorSender, userApplicant], // 重複含む
};

describe("selectReservationMessageRecipients", () => {
  it("団体側の送信（sentAsStaff = false）は事務局だけを宛先にし、送信者本人を除き、申請者・管理者・過去送信者を含まない", () => {
    const recipients = selectReservationMessageRecipients(audience, {
      sentAsStaff: false,
      senderUserId: "usr_staff1",
    });

    // 事務局から送信者本人 (usr_staff1) を除いた staff2 と staff_admin のみ（アドレス昇順）
    expect(recipients).toEqual([userStaffAdmin, userStaff2]);
  });

  it("事務局が団体の管理者を兼ねていても、団体側の送信なら事務局として届く", () => {
    // 送信者は一般メンバー
    const recipients = selectReservationMessageRecipients(audience, {
      sentAsStaff: false,
      senderUserId: "usr_applicant",
    });

    // 兼務している userStaffAdmin も事務局宛先に含まれる（アドレス昇順）
    expect(recipients).toContainEqual(userStaffAdmin);
    expect(recipients).toEqual([userStaffAdmin, userStaff1, userStaff2]);
  });

  it("事務局としての送信（sentAsStaff = true）は申請者・管理者・過去送信者の和集合となり、重複を除き、送信者本人を除く", () => {
    const recipients = selectReservationMessageRecipients(audience, {
      sentAsStaff: true,
      senderUserId: "usr_staff1", // 送信者は事務局員
    });

    // groupMembers (userApplicant, userAdmin, userStaffAdmin) + priorGroupSideSenders (userPriorSender, userApplicant)
    // userApplicant は重複排除される
    // アドレス昇順:
    // admin@..., applicant@..., prior@..., staff_admin@...
    expect(recipients).toEqual([userAdmin, userApplicant, userPriorSender, userStaffAdmin]);
  });

  it("事務局としての送信で、送信者本人が団体側リストに含まれる場合は除外される", () => {
    const recipients = selectReservationMessageRecipients(audience, {
      sentAsStaff: true,
      senderUserId: userApplicant.userId,
    });

    expect(recipients.find((r) => r.userId === userApplicant.userId)).toBeUndefined();
  });
});

describe("createReservationMessageMailDrafts", () => {
  const reservation = {
    id: "res_test_123",
    startAt: new Date("2026-10-15T10:00:00+09:00"),
    endAt: new Date("2026-10-15T12:00:00+09:00"),
  };

  it("メールの件名、本文、リンク、返信案内、idempotencyKey が正しく設定され、html は含まれない", () => {
    const message: ReservationMessage = {
      id: "msg_abc",
      reservationId: reservation.id,
      senderId: "usr_member",
      sentAsStaff: false,
      body: "利用人数の変更をお願いできますでしょうか。",
      sentAt: new Date("2026-10-05T12:00:00+09:00"),
    };

    const drafts = createReservationMessageMailDrafts({
      message,
      reservation,
      senderName: "山田太郎",
      recipients: [userStaff1],
      appBaseUrl: "https://example.com",
    });

    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;

    expect(draft.subject).toBe("【i-Club予約システム】予約にメッセージが届きました");
    expect(draft.to).toEqual({
      address: userStaff1.address,
      name: userStaff1.name,
    });
    expect(draft.idempotencyKey).toBe(`reservation-message:${message.id}:${userStaff1.userId}`);
    expect((draft as { html?: string }).html).toBeUndefined();

    // 本文の検証
    expect(draft.text).toContain("予約にメッセージが届きました。");
    expect(draft.text).toContain(`予約ID: ${reservation.id}`);
    expect(draft.text).toContain(`利用開始日時: ${formatDateTime(reservation.startAt)}`);
    expect(draft.text).toContain(`利用終了日時: ${formatDateTime(reservation.endAt)}`);
    expect(draft.text).toContain("送信者: 山田太郎");
    expect(draft.text).toContain("メッセージ:\n利用人数の変更をお願いできますでしょうか。");
    expect(draft.text).toContain("返信は、このメールではなく予約詳細ページから送ってください。");
    expect(draft.text).toContain(`https://example.com/reservations/${reservation.id}`);
    expect(draft.text).toContain("※このメールは送信専用です。返信はできません。");
  });

  it("sentAsStaff が true の場合は送信者が「事務局」となり senderName は本文のどこにも出ない", () => {
    const message: ReservationMessage = {
      id: "msg_xyz",
      reservationId: reservation.id,
      senderId: "usr_staff1",
      sentAsStaff: true,
      body: "承知いたしました。変更を受け付けます。",
      sentAt: new Date("2026-10-05T12:30:00+09:00"),
    };

    const drafts = createReservationMessageMailDrafts({
      message,
      reservation,
      senderName: "秘密の事務局員名",
      recipients: [userApplicant],
      appBaseUrl: "https://example.com",
    });

    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;

    expect(draft.text).toContain("送信者: 事務局");
    expect(draft.text).not.toContain("秘密の事務局員名");
  });
});
