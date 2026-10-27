import { describe, expect, it } from "vite-plus/test";

import {
  toStaffPendingReservations,
  type StaffPendingReservationItem,
} from "./staff-pending-reservations";

const NOW = new Date("2026-10-15T12:00:00+09:00");

/** 開始日時だけを変えた仮予約を作る */
const pending = (id: string, startAt: string): StaffPendingReservationItem => ({
  id,
  groupId: "grp_1",
  groupName: "テスト団体",
  facilityId: "fac_1",
  facilityName: "会議室",
  startAt: new Date(startAt),
  endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000),
  headCount: 2,
  requestedAt: new Date("2026-10-01T10:00:00+09:00"),
  hasApprovedOverlap: false,
  hasProvisionalOverlap: false,
});

describe("toStaffPendingReservations", () => {
  it("近い順の先頭 5 件を返し、総数は 5 件を超えた分も数える", () => {
    const rows = ["16", "17", "18", "19", "20", "21"].map((day) =>
      pending(`res_${day}`, `2026-10-${day}T10:00:00+09:00`),
    );

    const value = toStaffPendingReservations(rows, NOW);

    expect(value.items.map((item) => item.id)).toEqual([
      "res_16",
      "res_17",
      "res_18",
      "res_19",
      "res_20",
    ]);
    expect(value.totalCount).toBe(6);
  });

  it("利用日まで 7 日を切っている数は、ちょうど 7 日後に始まる予約を含めない（COND-028）", () => {
    const value = toStaffPendingReservations(
      [
        // 今日
        pending("res_today", "2026-10-15T18:00:00+09:00"),
        // 7 日後の日の、今の時刻より前
        pending("res_day7_morning", "2026-10-22T11:00:00+09:00"),
        // ちょうど 7 日後
        pending("res_day7_exact", "2026-10-22T12:00:00+09:00"),
        // 8 日後
        pending("res_day8", "2026-10-23T10:00:00+09:00"),
      ],
      NOW,
    );

    expect(value.totalCount).toBe(4);
    expect(value.shortNoticeCount).toBe(2);
  });
});
