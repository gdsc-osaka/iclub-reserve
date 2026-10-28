import { describe, expect, it } from "vite-plus/test";

import { MembershipRole, type Actor } from "../membership";
import { ReservationErrorCode, ReservationField, ReservationStatus, UnlockArrangement } from ".";
import { ReservationEditOutcome, type ReservationContentField } from "./edit";
import {
  canUpdateUnlockArrangement,
  parseUnlockArrangement,
  requiresUnlockArrangementReselection,
  toUnlockArrangementView,
  unlockArrangementAfterGroupEdit,
  unlockArrangementGroupNotice,
  validateUnlockArrangement,
  validateUnlockArrangementUpdate,
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

  describe("canUpdateUnlockArrangement", () => {
    const endAt = new Date("2026-10-20T12:00:00Z");

    it("承認済みで終了日時より前なら true を返す", () => {
      expect(
        canUpdateUnlockArrangement(
          { status: ReservationStatus.Approved, endAt },
          new Date("2026-10-20T11:59:59Z"),
        ),
      ).toBe(true);
    });

    it("仮予約など承認済みでないときは終了日時より前でも false を返す", () => {
      expect(
        canUpdateUnlockArrangement(
          { status: ReservationStatus.Provisional, endAt },
          new Date("2026-10-20T10:00:00Z"),
        ),
      ).toBe(false);
    });

    it("終了日時を過ぎているときは承認済みでも false を返す", () => {
      expect(
        canUpdateUnlockArrangement(
          { status: ReservationStatus.Approved, endAt },
          new Date("2026-10-20T12:00:01Z"),
        ),
      ).toBe(false);
    });

    it("ちょうど終了日時と同じ時刻（endAt === now）のときは false を返す", () => {
      expect(canUpdateUnlockArrangement({ status: ReservationStatus.Approved, endAt }, endAt)).toBe(
        false,
      );
    });
  });

  describe("validateUnlockArrangementUpdate", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const endAt = new Date("2026-10-20T12:00:00Z");

    it("承認済みでないときは InvalidTransition を返す", () => {
      const result = validateUnlockArrangementUpdate(
        {
          status: ReservationStatus.Provisional,
          endAt,
          unlockArrangement: null,
        },
        UnlockArrangement.Arranged,
        now,
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "解錠の手配は、承認済みの予約のみ変更できます。",
      });
    });

    it("終了日時が now 以前なら InvalidTransition を返す", () => {
      const result = validateUnlockArrangementUpdate(
        {
          status: ReservationStatus.Approved,
          endAt,
          unlockArrangement: UnlockArrangement.Required,
        },
        UnlockArrangement.Arranged,
        endAt,
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidTransition,
        userMessage: "終了した予約の解錠の手配は変更できません。",
      });
    });

    it("未選択（null）のときは validateUnlockArrangement と同じ InvalidInput を返す", () => {
      const result = validateUnlockArrangementUpdate(
        {
          status: ReservationStatus.Approved,
          endAt,
          unlockArrangement: UnlockArrangement.Required,
        },
        null,
        now,
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidInput,
        field: ReservationField.UnlockArrangement,
        userMessage: "解錠の手配を「要手配」「手配済み」「不要」から選んでください。",
      });
    });

    it("今の値と同じときは InvalidInput を返す", () => {
      const result = validateUnlockArrangementUpdate(
        {
          status: ReservationStatus.Approved,
          endAt,
          unlockArrangement: UnlockArrangement.Required,
        },
        UnlockArrangement.Required,
        now,
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: ReservationErrorCode.InvalidInput,
        field: ReservationField.UnlockArrangement,
        userMessage: "今と同じ手配の状況です。別の状況を選んでください。",
      });
    });

    it("未定（null）から 3 つの選択肢のいずれかへは更新できる", () => {
      for (const next of [
        UnlockArrangement.Required,
        UnlockArrangement.Arranged,
        UnlockArrangement.NotRequired,
      ]) {
        const result = validateUnlockArrangementUpdate(
          { status: ReservationStatus.Approved, endAt, unlockArrangement: null },
          next,
          now,
        );
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(next);
      }
    });

    it("承認済み・終了前で別の選択肢を選んだときは ok でその値を返す", () => {
      const result = validateUnlockArrangementUpdate(
        {
          status: ReservationStatus.Approved,
          endAt,
          unlockArrangement: UnlockArrangement.Required,
        },
        UnlockArrangement.Arranged,
        now,
      );
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(UnlockArrangement.Arranged);
    });
  });

  describe("toUnlockArrangementView", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const futureEndAt = new Date("2026-10-20T12:00:00Z");
    const pastEndAt = new Date("2026-10-20T09:00:00Z");

    const staffActor: Actor = { isStaff: true, membership: null };
    const groupActor: Actor = {
      isStaff: false,
      membership: { groupId: "grp_1", userId: "usr_1", role: MembershipRole.Member },
    };

    it("事務局の画面: 承認済みで終了前なら kind: 'staff' で canUpdate: true（未定でも出る）", () => {
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: futureEndAt,
            unlockArrangement: null,
          },
          staffActor,
          now,
        ),
      ).toEqual({
        kind: "staff",
        value: null,
        canUpdate: true,
      });

      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: futureEndAt,
            unlockArrangement: UnlockArrangement.Required,
          },
          staffActor,
          now,
        ),
      ).toEqual({
        kind: "staff",
        value: UnlockArrangement.Required,
        canUpdate: true,
      });
    });

    it("事務局の画面: 終了済みの承認済み予約でも状況は出し、canUpdate は false になる", () => {
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: pastEndAt,
            unlockArrangement: UnlockArrangement.Arranged,
          },
          staffActor,
          now,
        ),
      ).toEqual({
        kind: "staff",
        value: UnlockArrangement.Arranged,
        canUpdate: false,
      });
    });

    it("事務局の画面でも承認済みでない予約（仮予約・終了ステータス）では null を返す", () => {
      for (const status of [
        ReservationStatus.Provisional,
        ReservationStatus.Withdrawn,
        ReservationStatus.Rejected,
        ReservationStatus.Cancelled,
        ReservationStatus.CancelledByStaff,
      ]) {
        expect(
          toUnlockArrangementView(
            {
              status,
              endAt: futureEndAt,
              unlockArrangement: UnlockArrangement.Required,
            },
            staffActor,
            now,
          ),
        ).toBeNull();
      }
    });

    it("団体側: 承認済み・終了前で要手配または手配済みなら kind: 'group' で案内を返す", () => {
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: futureEndAt,
            unlockArrangement: UnlockArrangement.Required,
          },
          groupActor,
          now,
        ),
      ).toEqual({
        kind: "group",
        value: UnlockArrangement.Required,
        notice: unlockArrangementGroupNotice[UnlockArrangement.Required],
      });

      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: futureEndAt,
            unlockArrangement: UnlockArrangement.Arranged,
          },
          groupActor,
          now,
        ),
      ).toEqual({
        kind: "group",
        value: UnlockArrangement.Arranged,
        notice: unlockArrangementGroupNotice[UnlockArrangement.Arranged],
      });
    });

    it("団体側: 未定・不要・終了済み・仮予約では null を返す", () => {
      // 未定
      expect(
        toUnlockArrangementView(
          { status: ReservationStatus.Approved, endAt: futureEndAt, unlockArrangement: null },
          groupActor,
          now,
        ),
      ).toBeNull();

      // 不要
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: futureEndAt,
            unlockArrangement: UnlockArrangement.NotRequired,
          },
          groupActor,
          now,
        ),
      ).toBeNull();

      // 終了済み
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Approved,
            endAt: pastEndAt,
            unlockArrangement: UnlockArrangement.Required,
          },
          groupActor,
          now,
        ),
      ).toBeNull();

      // 仮予約
      expect(
        toUnlockArrangementView(
          {
            status: ReservationStatus.Provisional,
            endAt: futureEndAt,
            unlockArrangement: UnlockArrangement.Required,
          },
          groupActor,
          now,
        ),
      ).toBeNull();
    });
  });
});
