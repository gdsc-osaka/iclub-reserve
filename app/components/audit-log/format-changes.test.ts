import { describe, expect, it } from "vitest";

import { AuditLogTargetType } from "~/domain/audit-log";
import { formatChanges, formatSingleChangeText } from "./format-changes";

describe("format-changes", () => {
  const defaultOptions = {
    targetType: AuditLogTargetType.Reservation,
    userNames: { usr_1: "山田太郎" },
    facilityNames: { fac_1: "ミーティングルームA" },
  };

  describe("3 つの表示の形", () => {
    it("before と after が同じ場合は「項目名: 値」の形式になる", () => {
      const text = formatSingleChangeText("user_id", "usr_1", "usr_1", defaultOptions);
      expect(text).toBe("ユーザー: 山田太郎");
    });

    it("before が null の場合は「項目名: 新」の形式になる", () => {
      const text = formatSingleChangeText("head_count", null, 4, defaultOptions);
      expect(text).toBe("使用人数: 4");
    });

    it("それ以外の場合は「項目名: 旧 → 新」の形式になる（after が null なら（なし））", () => {
      const text1 = formatSingleChangeText("head_count", 2, 4, defaultOptions);
      expect(text1).toBe("使用人数: 2 → 4");

      const text2 = formatSingleChangeText("note", "事前の備考", null, defaultOptions);
      expect(text2).toBe("備考: 事前の備考 → （なし）");
    });
  });

  describe("各値の整形", () => {
    it("日時（*_at）を日本語日時に整形する", () => {
      const text = formatSingleChangeText(
        "start_at",
        "2026-06-28T08:54:30.000Z", // UTC 08:54 -> JST 17:54
        "2026-06-28T10:00:00.000Z", // UTC 10:00 -> JST 19:00
        defaultOptions,
      );
      expect(text).toBe("開始日時: 2026年6月28日 17:54 → 2026年6月28日 19:00");
    });

    it("予約の status を reservationStatusLabel で整形する", () => {
      const text = formatSingleChangeText("status", "provisional", "approved", {
        targetType: AuditLogTargetType.Reservation,
      });
      expect(text).toBe("状態: 仮予約 → 承認済み");
    });

    it("団体の status を groupStatusLabel で整形する", () => {
      const text = formatSingleChangeText("status", "pending", "enabled", {
        targetType: AuditLogTargetType.Group,
      });
      expect(text).toBe("状態: 承認待ち → 活動中");
    });

    it("招待の status を invitationStatusLabel で整形する", () => {
      const text = formatSingleChangeText("status", "pending", "accepted", {
        targetType: AuditLogTargetType.Invitation,
      });
      expect(text).toBe("状態: 承諾待ち → 承諾済み");
    });

    it("事務局権限の status を invitationStatusLabel で整形する", () => {
      const text1 = formatSingleChangeText("status", "pending", "canceled", {
        targetType: AuditLogTargetType.StaffRole,
      });
      expect(text1).toBe("状態: 承諾待ち → 取り消し済み");

      const text2 = formatSingleChangeText("status", "pending", "rejected", {
        targetType: AuditLogTargetType.StaffRole,
      });
      expect(text2).toBe("状態: 承諾待ち → 辞退済み");
    });

    it("calendar_url と staff_invitation_id の日本語ラベルで整形する", () => {
      const calText = formatSingleChangeText(
        "calendar_url",
        null,
        "https://calendar.google.com/test",
        defaultOptions,
      );
      expect(calText).toBe("カレンダー URL: https://calendar.google.com/test");

      const staffInvText = formatSingleChangeText(
        "staff_invitation_id",
        "inv_1",
        "inv_1",
        defaultOptions,
      );
      expect(staffInvText).toBe("事務局招待: inv_1");
    });

    it("役割（role）を membershipRoleLabel で整形する", () => {
      const text = formatSingleChangeText("role", "member", "admin", {
        targetType: AuditLogTargetType.Membership,
      });
      expect(text).toBe("役割: メンバー → 管理者");
    });

    it("有効/無効（is_active）を整形する", () => {
      const text = formatSingleChangeText("is_active", true, false, {
        targetType: AuditLogTargetType.Facility,
      });
      expect(text).toBe("有効/無効: 有効 → 無効");
    });

    it("事務局権限（is_staff）を整形する", () => {
      const text = formatSingleChangeText("is_staff", false, true, {
        targetType: AuditLogTargetType.StaffRole,
      });
      expect(text).toBe("事務局権限: なし → あり");
    });

    it("写真（photo_url）をあり/なしで整形し、URL を露出させない", () => {
      const text = formatSingleChangeText("photo_url", null, "https://example.com/photo.jpg", {
        targetType: AuditLogTargetType.Facility,
      });
      expect(text).toBe("写真: あり");
    });

    it("ユーザー ID・施設 ID を辞書から解決し、引けなければ（不明）にする", () => {
      const userText = formatSingleChangeText("user_id", "usr_1", "usr_unknown", defaultOptions);
      expect(userText).toBe("ユーザー: 山田太郎 → （不明）");

      const facilityText = formatSingleChangeText(
        "facility_id",
        "fac_unknown",
        "fac_1",
        defaultOptions,
      );
      expect(facilityText).toBe("施設/設備: （不明） → ミーティングルームA");
    });
  });

  describe("未知のキー", () => {
    it("表に無い未知のキーはキー名をそのまま表示する", () => {
      const text = formatSingleChangeText("unknown_field", "old_val", "new_val", defaultOptions);
      expect(text).toBe("unknown_field: old_val → new_val");
    });
  });

  describe("formatChanges 全体変換", () => {
    it("複数の変更項目を正しく整形した配列で返す", () => {
      const changes = {
        status: { before: "provisional", after: "approved" },
        status_reason: { before: null, after: "承認します" },
      };

      const result = formatChanges(changes, defaultOptions);
      expect(result).toEqual([
        {
          key: "status",
          label: "状態",
          displayText: "状態: 仮予約 → 承認済み",
        },
        {
          key: "status_reason",
          label: "理由",
          displayText: "理由: 承認します",
        },
      ]);
    });
  });
});
