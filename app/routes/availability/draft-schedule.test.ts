import { describe, expect, it } from "vite-plus/test";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { ReservationStatus } from "~/domain/reservation";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { calculateDraftSchedule } from "./draft-schedule";

describe("calculateDraftSchedule", () => {
  const dummyDay: AvailabilityDay = {
    date: new Date("2026-11-04T00:00:00+09:00"),
    dateKey: "2026-11-04",
    isToday: true,
    weekday: 3,
    isHoliday: false,
  };

  const now = new Date("2026-11-04T10:30:00+09:00");

  const approvedReservation: AvailabilityReservation = {
    id: "res_app",
    groupName: "ロボット部",
    startAt: new Date("2026-11-04T13:00:00+09:00"),
    endAt: new Date("2026-11-04T15:00:00+09:00"),
    status: ReservationStatus.Approved,
    isOwnGroup: true,
    hasApprovedOverlap: false,
    transitions: [],
    canEdit: false,
    detail: null,
  };

  const provisionalReservation: AvailabilityReservation = {
    id: "res_prov",
    groupName: "AI 部",
    startAt: new Date("2026-11-04T16:00:00+09:00"),
    endAt: new Date("2026-11-04T17:00:00+09:00"),
    status: ReservationStatus.Provisional,
    isOwnGroup: false,
    hasApprovedOverlap: false,
    transitions: [],
    canEdit: false,
    detail: null,
  };

  it("時刻が未選択（range: null）の場合", () => {
    const result = calculateDraftSchedule({
      draft: { dateKey: "2026-11-04", range: null },
      day: dummyDay,
      reservations: [approvedReservation],
      now,
    });

    expect(result.isAvailable).toBe(false);
    expect(result.isStartPast).toBe(false);
    expect(result.conflicts).toBeNull();
    expect(result.dayBlocks).toHaveLength(1);
  });

  it("空いている未来の時間帯を選択した場合", () => {
    const result = calculateDraftSchedule({
      draft: {
        dateKey: "2026-11-04",
        range: { startMinutes: 11 * 60, endMinutes: 12 * 60 },
      },
      day: dummyDay,
      reservations: [approvedReservation],
      now,
    });

    expect(result.isAvailable).toBe(true);
    expect(result.isStartPast).toBe(false);
    expect(result.conflicts?.approvedConflicts).toHaveLength(0);
    expect(result.conflicts?.provisionalConflicts).toHaveLength(0);
  });

  it("過ぎた時間帯を選択した場合", () => {
    const result = calculateDraftSchedule({
      draft: {
        dateKey: "2026-11-04",
        range: { startMinutes: 9 * 60, endMinutes: 10 * 60 },
      },
      day: dummyDay,
      reservations: [],
      now,
    });

    expect(result.isAvailable).toBe(false);
    expect(result.isStartPast).toBe(true);
  });

  it("承認済みの予約と重なる場合", () => {
    const result = calculateDraftSchedule({
      draft: {
        dateKey: "2026-11-04",
        range: { startMinutes: 14 * 60, endMinutes: 16 * 60 },
      },
      day: dummyDay,
      reservations: [approvedReservation],
      now,
    });

    expect(result.isAvailable).toBe(false);
    expect(result.isStartPast).toBe(false);
    expect(result.conflicts?.approvedConflicts).toHaveLength(1);
    expect(result.conflicts?.approvedConflicts[0]?.reservation.id).toBe("res_app");
  });

  it("仮予約と重なる場合（申請可能で provisionalConflicts に入る）", () => {
    const result = calculateDraftSchedule({
      draft: {
        dateKey: "2026-11-04",
        range: { startMinutes: 16 * 60, endMinutes: 17 * 60 },
      },
      day: dummyDay,
      reservations: [provisionalReservation],
      now,
    });

    expect(result.isAvailable).toBe(true);
    expect(result.conflicts?.approvedConflicts).toHaveLength(0);
    expect(result.conflicts?.provisionalConflicts).toHaveLength(1);
    expect(result.conflicts?.provisionalConflicts[0]?.reservation.id).toBe("res_prov");
  });
});
