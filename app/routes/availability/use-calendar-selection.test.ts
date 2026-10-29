import { describe, expect, it } from "vite-plus/test";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { ReservationStatus } from "~/domain/reservation";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";
import type { ReservationEditTarget } from "~/usecases/reservation/get-reservation-edit-form";

import {
  excludeEditingReservation,
  toOpenSelection,
  toRevealTarget,
} from "./use-calendar-selection";

describe("toOpenSelection", () => {
  const dummyReservation: AvailabilityReservation = {
    id: "res_1",
    groupName: "ロボット部",
    startAt: new Date("2026-11-04T10:00:00+09:00"),
    endAt: new Date("2026-11-04T12:00:00+09:00"),
    status: ReservationStatus.Approved,
    isOwnGroup: true,
    hasApprovedOverlap: false,
    hasProvisionalOverlap: false,
    transitions: [],
    canEdit: false,
    detail: null,
  };

  const dummyEditReservation: ReservationEditTarget = {
    id: "res_1",
    groupName: "ロボット部",
    facilityId: "fac_1",
    startAt: new Date("2026-11-04T10:00:00+09:00"),
    endAt: new Date("2026-11-04T12:00:00+09:00"),
    headCount: 5,
    note: "ミーティング",
    status: ReservationStatus.Approved,
  };

  const dummyDays: readonly AvailabilityDay[] = [
    {
      date: new Date("2026-11-04T00:00:00+09:00"),
      dateKey: "2026-11-04",
      isToday: false,
      weekday: 3,
      isHoliday: false,
    },
  ];

  it("rawSelection が null のときは null を返す", () => {
    expect(toOpenSelection(null, [dummyReservation], dummyDays, true)).toBeNull();
  });

  describe("reservation", () => {
    it("一覧に存在する予約ならそのまま返す", () => {
      const selection = { kind: "reservation" as const, reservationId: "res_1" };
      expect(toOpenSelection(selection, [dummyReservation], dummyDays, true)).toBe(selection);
    });

    it("一覧に存在しない予約 ID なら null を返す", () => {
      const selection = { kind: "reservation" as const, reservationId: "res_nonexistent" };
      expect(toOpenSelection(selection, [dummyReservation], dummyDays, true)).toBeNull();
    });
  });

  describe("draft", () => {
    const validDraft = {
      kind: "draft" as const,
      draft: {
        dateKey: "2026-11-04",
        range: { startMinutes: 600, endMinutes: 660 },
      },
    };

    it("期間内の日付かつ申請可能な人ならそのまま返す", () => {
      expect(toOpenSelection(validDraft, [dummyReservation], dummyDays, true)).toBe(validDraft);
    });

    it("申請できない人の場合は null を返す", () => {
      expect(toOpenSelection(validDraft, [dummyReservation], dummyDays, false)).toBeNull();
    });

    it("期間内にない日付キーの場合は null を返す", () => {
      const outOfRangeDraft = {
        kind: "draft" as const,
        draft: {
          dateKey: "2026-12-01",
          range: { startMinutes: 600, endMinutes: 660 },
        },
      };
      expect(toOpenSelection(outOfRangeDraft, [dummyReservation], dummyDays, true)).toBeNull();
    });
  });

  describe("edit", () => {
    it("変更前の予約が無いときは null を返す", () => {
      const selection = { kind: "edit" as const, reservationId: "res_1", draft: null };
      expect(toOpenSelection(selection, [dummyReservation], dummyDays, true, null)).toBeNull();
    });

    it("変更前の予約と ID が一致しないときは null を返す", () => {
      const selection = { kind: "edit" as const, reservationId: "res_different", draft: null };
      expect(
        toOpenSelection(selection, [dummyReservation], dummyDays, true, dummyEditReservation),
      ).toBeNull();
    });

    it("draft が無いときは変更前の予約から draft を生成して返す", () => {
      const selection = { kind: "edit" as const, reservationId: "res_1", draft: null };
      expect(
        toOpenSelection(selection, [dummyReservation], dummyDays, true, dummyEditReservation),
      ).toEqual({
        kind: "edit",
        reservationId: "res_1",
        draft: {
          dateKey: "2026-11-04",
          range: { startMinutes: 600, endMinutes: 720 },
        },
      });
    });

    it("canApply が false でも変更の選択は開ける（ローダーで変更可否を確認済み）", () => {
      const selection = { kind: "edit" as const, reservationId: "res_1", draft: null };
      expect(
        toOpenSelection(selection, [dummyReservation], dummyDays, false, dummyEditReservation),
      ).toEqual({
        kind: "edit",
        reservationId: "res_1",
        draft: {
          dateKey: "2026-11-04",
          range: { startMinutes: 600, endMinutes: 720 },
        },
      });
    });

    it("draft の日が 4 週間の外なら null を返す", () => {
      const outOfRangeDraft = {
        kind: "edit" as const,
        reservationId: "res_1",
        draft: {
          dateKey: "2026-12-01",
          range: { startMinutes: 600, endMinutes: 660 },
        },
      };
      expect(
        toOpenSelection(outOfRangeDraft, [dummyReservation], dummyDays, true, dummyEditReservation),
      ).toBeNull();
    });

    it("指定された draft が 4 週間の中にあればその draft を維持する", () => {
      const customDraft = {
        kind: "edit" as const,
        reservationId: "res_1",
        draft: {
          dateKey: "2026-11-04",
          range: { startMinutes: 780, endMinutes: 840 },
        },
      };
      expect(
        toOpenSelection(customDraft, [dummyReservation], dummyDays, true, dummyEditReservation),
      ).toEqual(customDraft);
    });
  });
});

describe("excludeEditingReservation", () => {
  const res1 = { id: "res_1" };
  const res2 = { id: "res_2" };
  const list = [res1, res2];

  it("変更を開いていない（null）ときは全件返す", () => {
    expect(excludeEditingReservation(list, null)).toBe(list);
  });

  it("変更する予約を除外する", () => {
    expect(excludeEditingReservation(list, "res_1")).toEqual([res2]);
  });
});

describe("toRevealTarget", () => {
  const reservation = (startAt: string, endAt: string): AvailabilityReservation => ({
    id: "res_1",
    groupName: "ロボット部",
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    status: ReservationStatus.Approved,
    isOwnGroup: true,
    hasApprovedOverlap: false,
    hasProvisionalOverlap: false,
    transitions: [],
    canEdit: false,
    detail: null,
  });
  const opened = { kind: "reservation", reservationId: "res_1" } as const;

  it("仮の枠は、その日と時間帯", () => {
    const draft = { dateKey: "2026-11-04", range: { startMinutes: 630, endMinutes: 690 } };
    expect(toRevealTarget({ kind: "draft", draft }, [])).toEqual(draft);
  });

  it("時刻を持たない仮の枠でも日付を返す（range は null）", () => {
    const draft = { dateKey: "2026-11-04", range: null };
    expect(toRevealTarget({ kind: "draft", draft }, [])).toEqual(draft);
  });

  it("変更の枠も、その日と時間帯を返す", () => {
    const draft = { dateKey: "2026-11-04", range: { startMinutes: 630, endMinutes: 690 } };
    expect(toRevealTarget({ kind: "edit", reservationId: "res_1", draft }, [])).toEqual(draft);
  });

  it("予約は、その日と時間帯", () => {
    const item = reservation("2026-11-04T10:00:00+09:00", "2026-11-04T12:00:00+09:00");
    expect(toRevealTarget(opened, [item])).toEqual({
      dateKey: "2026-11-04",
      range: { startMinutes: 600, endMinutes: 720 },
    });
  });

  it("予約は、帯と同じく 9:00〜21:00 に切り詰める", () => {
    const item = reservation("2026-11-04T07:30:00+09:00", "2026-11-04T22:00:00+09:00");
    expect(toRevealTarget(opened, [item])).toEqual({
      dateKey: "2026-11-04",
      range: { startMinutes: 540, endMinutes: 1260 },
    });
  });

  it("開いているものが無い・予約がデータに無いときは null", () => {
    expect(toRevealTarget(null, [])).toBeNull();
    expect(toRevealTarget(opened, [])).toBeNull();
  });
});
