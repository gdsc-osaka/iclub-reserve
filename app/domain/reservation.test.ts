import { describe, expect, it } from "vitest";

import {
  ACTIVE_RESERVATION_STATUSES,
  isActiveReservationStatus,
  ReservationStatus,
} from "./reservation";

describe("isActiveReservationStatus", () => {
  it.each([ReservationStatus.Provisional, ReservationStatus.Approved])(
    "%s はまだ生きている予約として扱う",
    (status) => {
      expect(isActiveReservationStatus(status)).toBe(true);
    },
  );

  it.each([
    ReservationStatus.Withdrawn,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.CancelledByStaff,
  ])("%s は日時が未来でも記録として扱う", (status) => {
    expect(isActiveReservationStatus(status)).toBe(false);
  });

  it("すべてのステータスがどちらかに分類される", () => {
    const all = Object.values(ReservationStatus);
    const active = all.filter((status) => isActiveReservationStatus(status));

    // 分類漏れがあると、その予約が「これから」にも「履歴」にも出なくなる
    expect(active).toEqual([...ACTIVE_RESERVATION_STATUSES]);
    expect(all).toHaveLength(6);
  });
});
