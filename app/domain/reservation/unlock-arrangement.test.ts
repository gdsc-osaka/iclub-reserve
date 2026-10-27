import { describe, expect, it } from "vite-plus/test";

import { ReservationErrorCode, ReservationField, ReservationStatus, UnlockArrangement } from ".";
import { ReservationEditOutcome, type ReservationContentField } from "./edit";
import {
  parseUnlockArrangement,
  requiresUnlockArrangementReselection,
  unlockArrangementAfterGroupEdit,
  validateUnlockArrangement,
} from "./unlock-arrangement";

describe("unlock-arrangement", () => {
  describe("parseUnlockArrangement", () => {
    it("定義されている文字列を正しい UnlockArrangement に変換する", () => {
      expect(parseUnlockArrangement("required")).toBe(UnlockArrangement.Required);
      expect(parseUnlockArrangement("arranged")).toBe(UnlockArrangement.Arranged);
      expect(parseUnlockArrangement("not_required")).toBe(UnlockArrangement.NotRequired);
    });

    it("知らない文字列や null、文字列以外は null を返す", () => {
      expect(parseUnlockArrangement("unknown")).toBeNull();
      expect(parseUnlockArrangement("")).toBeNull();
      expect(parseUnlockArrangement(null)).toBeNull();
      expect(parseUnlockArrangement(undefined)).toBeNull();
      expect(parseUnlockArrangement(123)).toBeNull();
      expect(parseUnlockArrangement({})).toBeNull();
    });
  });

  describe("validateUnlockArrangement", () => {
    it("有効な値の場合は ok でその値を返す", () => {
      const result = validateUnlockArrangement(UnlockArrangement.Required);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(UnlockArrangement.Required);
      }
    });

    it("null の場合は InvalidInput エラーを返す", () => {
      const result = validateUnlockArrangement(null);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ReservationErrorCode.InvalidInput);
        expect(result.error.field).toBe(ReservationField.UnlockArrangement);
        expect(result.error.userMessage).toBe(
          "解錠の手配を「要手配」「手配済み」「不要」から選んでください。",
        );
      }
    });
  });

  describe("requiresUnlockArrangementReselection", () => {
    it("承認済みで施設・開始・終了のいずれかを変更したときは true を返す", () => {
      const facilityChanged: ReadonlySet<ReservationContentField> = new Set(["facilityId"]);
      const startAtChanged: ReadonlySet<ReservationContentField> = new Set(["startAt"]);
      const endAtChanged: ReadonlySet<ReservationContentField> = new Set(["endAt"]);

      expect(
        requiresUnlockArrangementReselection(ReservationStatus.Approved, facilityChanged),
      ).toBe(true);
      expect(requiresUnlockArrangementReselection(ReservationStatus.Approved, startAtChanged)).toBe(
        true,
      );
      expect(requiresUnlockArrangementReselection(ReservationStatus.Approved, endAtChanged)).toBe(
        true,
      );
    });

    it("承認済みで使用人数や備考のみを変更したときは false を返す", () => {
      const headCountChanged: ReadonlySet<ReservationContentField> = new Set(["headCount"]);
      const noteChanged: ReadonlySet<ReservationContentField> = new Set(["note"]);
      const headCountAndNoteChanged: ReadonlySet<ReservationContentField> = new Set([
        "headCount",
        "note",
      ]);

      expect(
        requiresUnlockArrangementReselection(ReservationStatus.Approved, headCountChanged),
      ).toBe(false);
      expect(requiresUnlockArrangementReselection(ReservationStatus.Approved, noteChanged)).toBe(
        false,
      );
      expect(
        requiresUnlockArrangementReselection(ReservationStatus.Approved, headCountAndNoteChanged),
      ).toBe(false);
    });

    it("仮予約のときは施設・日時を変更しても false を返す", () => {
      const facilityAndPeriodChanged: ReadonlySet<ReservationContentField> = new Set([
        "facilityId",
        "startAt",
        "endAt",
      ]);

      expect(
        requiresUnlockArrangementReselection(
          ReservationStatus.Provisional,
          facilityAndPeriodChanged,
        ),
      ).toBe(false);
    });
  });

  describe("unlockArrangementAfterGroupEdit", () => {
    it("再承認待ち（Reapproval）になったときは null に戻す", () => {
      expect(
        unlockArrangementAfterGroupEdit(
          ReservationEditOutcome.Reapproval,
          UnlockArrangement.Required,
        ),
      ).toBeNull();
      expect(
        unlockArrangementAfterGroupEdit(
          ReservationEditOutcome.Reapproval,
          UnlockArrangement.Arranged,
        ),
      ).toBeNull();
      expect(
        unlockArrangementAfterGroupEdit(
          ReservationEditOutcome.Reapproval,
          UnlockArrangement.NotRequired,
        ),
      ).toBeNull();
      expect(unlockArrangementAfterGroupEdit(ReservationEditOutcome.Reapproval, null)).toBeNull();
    });

    it("仮予約のまま編集（KeepProvisional）されたときは元の値のまま変わらない", () => {
      expect(
        unlockArrangementAfterGroupEdit(ReservationEditOutcome.KeepProvisional, null),
      ).toBeNull();
      expect(
        unlockArrangementAfterGroupEdit(
          ReservationEditOutcome.KeepProvisional,
          UnlockArrangement.Required,
        ),
      ).toBe(UnlockArrangement.Required);
    });

    it("承認済みのまま使用人数・備考を編集（KeepApproved）されたときは元の値のまま変わらない", () => {
      expect(
        unlockArrangementAfterGroupEdit(
          ReservationEditOutcome.KeepApproved,
          UnlockArrangement.Arranged,
        ),
      ).toBe(UnlockArrangement.Arranged);
    });
  });
});
