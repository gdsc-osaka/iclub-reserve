import { describe, expect, it } from "vite-plus/test";

import { addDays } from "~/lib/date";
import { ReservationEditOutcome } from "~/domain/reservation/edit";
import { shouldShowApplicationNotice, shouldShowShortNoticeAlert } from "./notice";

describe("editor/notice", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  const shortNoticeDate = new Date("2026-10-05T10:00:00.000Z");
  const longNoticeDate = new Date("2026-10-15T10:00:00.000Z");
  const exact7Days = addDays(now, 7);

  describe("shouldShowApplicationNotice", () => {
    it("団体の申請（直接作成でない）で7日以上先またはちょうど7日後のときは true を返す", () => {
      expect(
        shouldShowApplicationNotice({ kind: "create", isDirect: false }, longNoticeDate, now),
      ).toBe(true);
      expect(
        shouldShowApplicationNotice({ kind: "create", isDirect: false }, exact7Days, now),
      ).toBe(true);
    });

    it("団体の申請で7日を切っているときは false を返す", () => {
      expect(
        shouldShowApplicationNotice({ kind: "create", isDirect: false }, shortNoticeDate, now),
      ).toBe(false);
    });

    it("団体の申請で時刻を選んでいない（null）ときは true を返す", () => {
      expect(shouldShowApplicationNotice({ kind: "create", isDirect: false }, null, now)).toBe(
        true,
      );
    });

    it("直接作成のときは7日以上先でも7日を切っていても false を返す", () => {
      expect(
        shouldShowApplicationNotice({ kind: "create", isDirect: true }, longNoticeDate, now),
      ).toBe(false);
      expect(
        shouldShowApplicationNotice({ kind: "create", isDirect: true }, shortNoticeDate, now),
      ).toBe(false);
    });

    it("団体の変更で仮予約に戻る・仮予約のままのときは、7日以上先なら true、7日を切っていると false を返す", () => {
      expect(
        shouldShowApplicationNotice(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.Reapproval },
          longNoticeDate,
          now,
        ),
      ).toBe(true);
      expect(
        shouldShowApplicationNotice(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.KeepProvisional },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
    });

    it("団体の変更で承認済みのまま使用人数・備考だけを変えるときは、7日を切っていても true を返す", () => {
      expect(
        shouldShowApplicationNotice(
          { kind: "edit", isDirect: false, outcome: ReservationEditOutcome.KeepApproved },
          shortNoticeDate,
          now,
        ),
      ).toBe(true);
    });

    it("直接変更のときは7日以上先でも7日を切っていても false を返す", () => {
      expect(
        shouldShowApplicationNotice(
          { kind: "edit", isDirect: true, outcome: ReservationEditOutcome.KeepApproved },
          longNoticeDate,
          now,
        ),
      ).toBe(false);
      expect(
        shouldShowApplicationNotice(
          { kind: "edit", isDirect: true, outcome: ReservationEditOutcome.KeepProvisional },
          shortNoticeDate,
          now,
        ),
      ).toBe(false);
    });
  });

  describe("shouldShowShortNoticeAlert", () => {
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
