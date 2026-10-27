import { describe, expect, it } from "vitest";

import { addDays } from "~/lib/date";
import { ReservationEditOutcome } from "~/domain/reservation/edit";
import { shouldShowApplicationNotice, shouldShowShortNoticeAlert } from "./notice";

describe("editor/notice", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  describe("shouldShowApplicationNotice", () => {
    it("団体の申請（直接作成でない）のときは true を返す", () => {
      expect(shouldShowApplicationNotice({ kind: "create", isDirect: false })).toBe(true);
    });

    it("直接作成のときは false を返す", () => {
      expect(shouldShowApplicationNotice({ kind: "create", isDirect: true })).toBe(false);
    });

    it("団体の変更（直接変更でない）のときは true を返す", () => {
      expect(
        shouldShowApplicationNotice({
          kind: "edit",
          isDirect: false,
          outcome: ReservationEditOutcome.KeepProvisional,
        }),
      ).toBe(true);
    });

    it("直接変更のときは false を返す", () => {
      expect(
        shouldShowApplicationNotice({
          kind: "edit",
          isDirect: true,
          outcome: ReservationEditOutcome.KeepApproved,
        }),
      ).toBe(false);
    });
  });

  describe("shouldShowShortNoticeAlert", () => {
    const shortNoticeDate = new Date("2026-10-05T10:00:00.000Z");
    const longNoticeDate = new Date("2026-10-15T10:00:00.000Z");
    const exact7Days = addDays(now, 7);

    it("申請で7日を切っているときは true を返す", () => {
      expect(
        shouldShowShortNoticeAlert({ kind: "create", isDirect: false }, shortNoticeDate, now),
      ).toBe(true);
    });

    it("申請で7日以上先またはちょうど7日後のときは false を返す", () => {
      expect(
        shouldShowShortNoticeAlert({ kind: "create", isDirect: false }, longNoticeDate, now),
      ).toBe(false);
      expect(shouldShowShortNoticeAlert({ kind: "create", isDirect: false }, exact7Days, now)).toBe(
        false,
      );
    });

    it("申請で日時が未選択（null）のときは false を返す", () => {
      expect(shouldShowShortNoticeAlert({ kind: "create", isDirect: false }, null, now)).toBe(
        false,
      );
    });

    it("直接作成のときは日時が7日を切っていても false を返す", () => {
      expect(
        shouldShowShortNoticeAlert({ kind: "create", isDirect: true }, shortNoticeDate, now),
      ).toBe(false);
    });

    it("団体の変更で仮予約に戻る（Reapproval）ときは、7日を切っていれば true を返す", () => {
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.Reapproval },
          shortNoticeDate,
          now,
        ),
      ).toBe(true);
    });

    it("団体の変更で仮予約のまま（KeepProvisional）のときは、7日を切っていれば true を返す", () => {
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.KeepProvisional },
          shortNoticeDate,
          now,
        ),
      ).toBe(true);
    });

    it("団体の変更で承認済みのまま（KeepApproved）のときは、7日を切っていても false を返す", () => {
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.KeepApproved },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
    });

    it("団体の変更で変更なし（NoChange）のときは、7日を切っていても false を返す", () => {
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.NoChange },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
    });

    it("直接変更のときは、7日を切っていても false を返す", () => {
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: true, outcome: ReservationEditOutcome.KeepApproved },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
      expect(
        shouldShowShortNoticeAlert(
          { kind: "edit", isDirect: true, outcome: ReservationEditOutcome.KeepProvisional },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
    });
  });
});
