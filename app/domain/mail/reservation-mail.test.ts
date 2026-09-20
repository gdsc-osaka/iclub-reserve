import { describe, expect, it } from "vitest";
import {
  createReservationMailDrafts,
  notifiesStaff,
  ReservationMailEvent,
  transitionMailEvent,
  type ReservationMailAudience,
} from "./reservation-mail";
import { ReservationTransition } from "~/domain/reservation/transition";

describe("reservation-mail", () => {
  const baseReservation = {
    id: "res_test_123",
    startAt: new Date("2026-09-25T10:00:00+09:00"),
    endAt: new Date("2026-09-25T12:00:00+09:00"),
    statusReason: null,
  };

  const defaultAudience: ReservationMailAudience = {
    groupMembers: [
      { userId: "usr_student", address: "student@example.com", name: "山田太郎" },
      { userId: "usr_admin", address: "admin@example.com", name: "管理者花子" },
    ],
    staff: [{ userId: "usr_staff", address: "staff@example.com", name: "事務局員" }],
  };

  // --- 既存の承認通知のケース（文面・鍵を 1 バイトも変えずに残す） ---
  describe("EVT-005 承認通知（既存仕様の保護）", () => {
    it("件名に承認された旨が含まれる", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Approved,
        baseReservation,
        defaultAudience,
      );
      expect(drafts[0]?.subject).toBe("【i-Club予約システム】施設・設備の利用予約が承認されました");
    });

    it("本文に予約IDと日時が含まれる", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Approved,
        baseReservation,
        defaultAudience,
      );
      const body = drafts[0]?.text ?? "";
      expect(body).toContain("res_test_123");
      expect(body).toContain("2026年9月25日 10:00");
      expect(body).toContain("2026年9月25日 12:00");
      expect(body).toBe(
        [
          "i-Club 予約システムをご利用いただきありがとうございます。",
          "",
          "申請されていた利用予約が承認されました。",
          "",
          "予約ID: res_test_123",
          "利用開始日時: 2026年9月25日 10:00",
          "利用終了日時: 2026年9月25日 12:00",
          "",
          "詳細はシステムにログインしてご確認ください。",
          "",
          "----------------------------------------",
          "大阪大学 Innovators' Club (i-Club) 予約システム",
          "※このメールは送信専用です。返信はできません。",
        ].join("\n"),
      );
    });

    it("createReservationApprovedMailDrafts 相当の決定的な idempotencyKey と文面を持つ MailDraft を生成する", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Approved,
        baseReservation,
        defaultAudience,
      );

      // 承認通知は事務局には送らないため groupMembers の 2 件のみ
      expect(drafts).toHaveLength(2);

      expect(drafts[0]).toEqual({
        idempotencyKey: "reservation:approved:res_test_123:usr_student",
        to: {
          address: "student@example.com",
          name: "山田太郎",
        },
        subject: "【i-Club予約システム】施設・設備の利用予約が承認されました",
        text: expect.stringContaining("res_test_123"),
      });

      expect(drafts[1]).toEqual({
        idempotencyKey: "reservation:approved:res_test_123:usr_admin",
        to: {
          address: "admin@example.com",
          name: "管理者花子",
        },
        subject: "【i-Club予約システム】施設・設備の利用予約が承認されました",
        text: expect.stringContaining("res_test_123"),
      });
    });

    it("userId が未指定の場合は address が idempotencyKey の末尾に使われる", () => {
      const audience: ReservationMailAudience = {
        groupMembers: [{ address: "student@example.com" }],
        staff: [],
      };
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Approved,
        baseReservation,
        audience,
      );

      expect(drafts[0]?.idempotencyKey).toBe(
        "reservation:approved:res_test_123:student@example.com",
      );
    });
  });

  // --- 6 つのイベントの文面と件名の網羅テスト ---
  describe("全イベントの件名・冒頭文・idempotencyKey", () => {
    const testCases = [
      {
        event: ReservationMailEvent.Applied,
        expectedSubject: "【i-Club予約システム】施設・設備の利用予約が申請されました",
        expectedOpening: "施設・設備の利用予約が申請されました。",
        prefix: "reservation:applied:res_test_123:",
      },
      {
        event: ReservationMailEvent.Withdrawn,
        expectedSubject: "【i-Club予約システム】施設・設備の仮予約が取り消されました",
        expectedOpening: "申請されていた仮予約が取り消されました。",
        prefix: "reservation:withdrawn:res_test_123:",
      },
      {
        event: ReservationMailEvent.Cancelled,
        expectedSubject: "【i-Club予約システム】施設・設備の利用予約がキャンセルされました",
        expectedOpening: "承認済みの利用予約がキャンセルされました。",
        prefix: "reservation:cancelled:res_test_123:",
      },
      {
        event: ReservationMailEvent.Approved,
        expectedSubject: "【i-Club予約システム】施設・設備の利用予約が承認されました",
        expectedOpening: "申請されていた利用予約が承認されました。",
        prefix: "reservation:approved:res_test_123:",
      },
      {
        event: ReservationMailEvent.Rejected,
        expectedSubject: "【i-Club予約システム】施設・設備の利用予約が却下されました",
        expectedOpening: "申請されていた利用予約が却下されました。",
        prefix: "reservation:rejected:res_test_123:",
      },
      {
        event: ReservationMailEvent.CancelledByStaff,
        expectedSubject:
          "【i-Club予約システム】施設・設備の利用予約が事務局によりキャンセルされました",
        expectedOpening: "承認済みの利用予約が事務局によりキャンセルされました。",
        prefix: "reservation:cancelledByStaff:res_test_123:",
      },
    ] as const;

    it.each(testCases)(
      "$event の件名と冒頭文と idempotencyKey が規定どおりであること",
      ({ event, expectedSubject, expectedOpening, prefix }) => {
        const drafts = createReservationMailDrafts(event, baseReservation, defaultAudience);

        expect(drafts[0]?.subject).toBe(expectedSubject);
        expect(drafts[0]?.text).toContain(expectedOpening);
        expect(drafts[0]?.idempotencyKey).toBe(`${prefix}usr_student`);
      },
    );
  });

  // --- notifiesStaff の固定テスト ---
  describe("notifiesStaff（事務局への通知制御）", () => {
    it("notifiesStaff 定義が PRD 5 章の仕様どおりに固定されていること", () => {
      expect(notifiesStaff).toEqual({
        [ReservationMailEvent.Applied]: true,
        [ReservationMailEvent.Withdrawn]: false,
        [ReservationMailEvent.Cancelled]: true,
        [ReservationMailEvent.Approved]: false,
        [ReservationMailEvent.Rejected]: false,
        [ReservationMailEvent.CancelledByStaff]: false,
      });
    });

    it("applied と cancelled では staff 宛の MailDraft が生成される", () => {
      const audience: ReservationMailAudience = {
        groupMembers: [{ userId: "usr_student", address: "student@example.com" }],
        staff: [{ userId: "usr_staff", address: "staff@example.com" }],
      };

      for (const event of [ReservationMailEvent.Applied, ReservationMailEvent.Cancelled]) {
        const drafts = createReservationMailDrafts(event, baseReservation, audience);
        expect(drafts).toHaveLength(2);
        expect(drafts.map((d) => d.to.address)).toEqual([
          "student@example.com",
          "staff@example.com",
        ]);
      }
    });

    it("withdrawn / approved / rejected / cancelledByStaff では staff 宛の MailDraft が生成されない", () => {
      const audience: ReservationMailAudience = {
        groupMembers: [{ userId: "usr_student", address: "student@example.com" }],
        staff: [{ userId: "usr_staff", address: "staff@example.com" }],
      };

      const noStaffEvents = [
        ReservationMailEvent.Withdrawn,
        ReservationMailEvent.Approved,
        ReservationMailEvent.Rejected,
        ReservationMailEvent.CancelledByStaff,
      ];

      for (const event of noStaffEvents) {
        const drafts = createReservationMailDrafts(event, baseReservation, audience);
        expect(drafts).toHaveLength(1);
        expect(drafts[0]?.to.address).toBe("student@example.com");
      }
    });
  });

  // --- 理由行の出力条件テスト ---
  describe("理由行の出力条件", () => {
    it("statusReason が null のときは本文に理由の行が出ない", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Rejected,
        { ...baseReservation, statusReason: null },
        defaultAudience,
      );
      expect(drafts[0]?.text).not.toContain("理由:");
    });

    it("rejected で理由が入っているときは本文に理由の行が出る", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.Rejected,
        { ...baseReservation, statusReason: "設備メンテナンスのため" },
        defaultAudience,
      );
      expect(drafts[0]?.text).toContain("\n\n理由: 設備メンテナンスのため\n\n");
    });

    it("cancelledByStaff で理由が入っているときは本文に理由の行が出る", () => {
      const drafts = createReservationMailDrafts(
        ReservationMailEvent.CancelledByStaff,
        { ...baseReservation, statusReason: "大学公式行事のため" },
        defaultAudience,
      );
      expect(drafts[0]?.text).toContain("\n\n理由: 大学公式行事のため\n\n");
    });

    it("cancelled や withdrawn で理由が入っているときは本文に理由の行が出る", () => {
      const draftsWithdrawn = createReservationMailDrafts(
        ReservationMailEvent.Withdrawn,
        { ...baseReservation, statusReason: "日程変更のため" },
        defaultAudience,
      );
      expect(draftsWithdrawn[0]?.text).toContain("\n\n理由: 日程変更のため\n\n");

      const draftsCancelled = createReservationMailDrafts(
        ReservationMailEvent.Cancelled,
        { ...baseReservation, statusReason: "参加者不足のため" },
        defaultAudience,
      );
      expect(draftsCancelled[0]?.text).toContain("\n\n理由: 参加者不足のため\n\n");
    });

    it("applied や approved は statusReason があっても理由を出さない", () => {
      const draftsApplied = createReservationMailDrafts(
        ReservationMailEvent.Applied,
        { ...baseReservation, statusReason: "何らかの理由" },
        defaultAudience,
      );
      expect(draftsApplied[0]?.text).not.toContain("理由:");

      const draftsApproved = createReservationMailDrafts(
        ReservationMailEvent.Approved,
        { ...baseReservation, statusReason: "何らかの理由" },
        defaultAudience,
      );
      expect(draftsApproved[0]?.text).not.toContain("理由:");
    });
  });

  // --- transitionMailEvent の型付けとマッピングテスト ---
  describe("transitionMailEvent", () => {
    it("すべての状態変更操作に対応するイベントが定義されている", () => {
      expect(transitionMailEvent).toEqual({
        [ReservationTransition.Withdraw]: ReservationMailEvent.Withdrawn,
        [ReservationTransition.Cancel]: ReservationMailEvent.Cancelled,
        [ReservationTransition.Approve]: ReservationMailEvent.Approved,
        [ReservationTransition.Reject]: ReservationMailEvent.Rejected,
        [ReservationTransition.StaffCancel]: ReservationMailEvent.CancelledByStaff,
      });
    });
  });
});
