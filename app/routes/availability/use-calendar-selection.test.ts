import { describe, expect, it } from "vite-plus/test";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { ReservationStatus } from "~/domain/reservation";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { toOpenSelection, toRevealTarget } from "./use-calendar-selection";

describe("toOpenSelection", () => {
  const dummyReservation: AvailabilityReservation = {
    id: "res_1",
    groupName: "ロボット部",
    startAt: new Date("2026-11-04T10:00:00+09:00"),
    endAt: new Date("2026-11-04T12:00:00+09:00"),
    status: ReservationStatus.Approved,
    isOwnGroup: true,
    hasApprovedOverlap: false,
    transitions: [],
    canEdit: false,
    detail: null,
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
