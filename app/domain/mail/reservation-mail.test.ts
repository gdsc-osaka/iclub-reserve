import { describe, expect, it } from "vitest";
import {
  buildReservationApprovedBody,
  buildReservationApprovedSubject,
  createReservationApprovedMailDrafts,
} from "./reservation-mail";

describe("reservation-mail", () => {
  const reservation = {
    id: "res_test_123",
    startAt: new Date("2026-09-25T10:00:00+09:00"),
    endAt: new Date("2026-09-25T12:00:00+09:00"),
  };

  it("件名に承認された旨が含まれる", () => {
    const subject = buildReservationApprovedSubject();
    expect(subject).toContain("承認されました");
  });

  it("本文に予約IDと日時が含まれる", () => {
    const body = buildReservationApprovedBody(reservation);
    expect(body).toContain("res_test_123");
    expect(body).toContain("2026年9月25日 10:00");
    expect(body).toContain("2026年9月25日 12:00");
  });

  it("createReservationApprovedMailDrafts が決定的な idempotencyKey と文面を持つ MailDraft を生成する", () => {
    const recipients = [
      { userId: "usr_student", address: "student@example.com", name: "山田太郎" },
      { userId: "usr_admin", address: "admin@example.com", name: "管理者花子" },
    ];

    const drafts = createReservationApprovedMailDrafts(reservation, recipients);

    expect(drafts).toHaveLength(2);

    expect(drafts[0]).toEqual({
      idempotencyKey: "reservation:approved:res_test_123:usr_student",
      to: {
        address: "student@example.com",
        name: "山田太郎",
      },
      subject: expect.stringContaining("承認されました"),
      text: expect.stringContaining("res_test_123"),
    });

    expect(drafts[1]).toEqual({
      idempotencyKey: "reservation:approved:res_test_123:usr_admin",
      to: {
        address: "admin@example.com",
        name: "管理者花子",
      },
      subject: expect.stringContaining("承認されました"),
      text: expect.stringContaining("res_test_123"),
    });
  });

  it("userId が未指定の場合は address が idempotencyKey の末尾に使われる", () => {
    const drafts = createReservationApprovedMailDrafts(reservation, [
      { address: "student@example.com" },
    ]);

    expect(drafts[0]?.idempotencyKey).toBe("reservation:approved:res_test_123:student@example.com");
  });
});
