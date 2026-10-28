import { describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { toReservationListEntries } from "./reservation-list-entries";

const createItem = (
  overrides: Partial<ReservationListItem> & { id: string },
): ReservationListItem => ({
  id: overrides.id,
  groupName: overrides.groupName ?? "テスト団体",
  facilityId: overrides.facilityId ?? "fac-1",
  facilityName: overrides.facilityName ?? "テスト施設",
  startAt: overrides.startAt ?? new Date("2026-11-12T01:00:00.000Z"), // JST 10:00
  endAt: overrides.endAt ?? new Date("2026-11-12T03:00:00.000Z"), // JST 12:00
  status: overrides.status ?? ReservationStatus.Provisional,
  statusReason: overrides.statusReason ?? null,
  headCount: overrides.headCount ?? 4,
  note: overrides.note ?? null,
  createdByName: overrides.createdByName ?? "申請者",
  requestedAt: overrides.requestedAt ?? new Date("2026-10-01T00:00:00.000Z"),
  hasApprovedOverlap: overrides.hasApprovedOverlap ?? false,
  hasProvisionalOverlap: overrides.hasProvisionalOverlap ?? false,
});

describe("toReservationListEntries", () => {
  it("利用者の画面（isStaffArea = false）ではすべて行のまま返す", () => {
    // 同じ施設・重なり合う仮予約 2 件
    const item1 = createItem({
      id: "res-1",
      startAt: new Date("2026-11-12T01:00:00.000Z"), // 10:00
      endAt: new Date("2026-11-12T03:00:00.000Z"), // 12:00
    });
    const item2 = createItem({
      id: "res-2",
      startAt: new Date("2026-11-12T02:00:00.000Z"), // 11:00
      endAt: new Date("2026-11-12T04:00:00.000Z"), // 13:00
    });

    const entries = toReservationListEntries([item1, item2], false);

    expect(entries).toEqual([
      { kind: "row", item: item1 },
      { kind: "row", item: item2 },
    ]);
  });

  it("重なる 3 件（つながりの例）が 1 つのまとまりになり、最も前の位置に置かれる", () => {
    // 施設 1 で 10〜12時 (res-1) と 12〜14時 (res-3) は直接重ならないが、どちらも 11〜13時 (res-2) と重なる
    // 一覧の並びは res-1, res-other, res-2, res-3 とする
    const res1 = createItem({
      id: "res-1",
      startAt: new Date("2026-11-12T01:00:00.000Z"), // 10:00
      endAt: new Date("2026-11-12T03:00:00.000Z"), // 12:00
      requestedAt: new Date("2026-10-01T09:00:00.000Z"),
    });
    const resOther = createItem({
      id: "res-other",
      facilityId: "fac-2", // 別施設
      startAt: new Date("2026-11-12T01:00:00.000Z"),
      endAt: new Date("2026-11-12T03:00:00.000Z"),
    });
    const res2 = createItem({
      id: "res-2",
      startAt: new Date("2026-11-12T02:00:00.000Z"), // 11:00
      endAt: new Date("2026-11-12T04:00:00.000Z"), // 13:00
      requestedAt: new Date("2026-10-01T10:00:00.000Z"),
    });
    const res3 = createItem({
      id: "res-3",
      startAt: new Date("2026-11-12T03:00:00.000Z"), // 12:00
      endAt: new Date("2026-11-12T05:00:00.000Z"), // 14:00
      requestedAt: new Date("2026-10-01T11:00:00.000Z"),
    });

    const entries = toReservationListEntries([res1, resOther, res2, res3], true);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("overlap");
    if (entries[0]?.kind === "overlap") {
      expect(entries[0].items.map((i) => i.id)).toEqual(["res-1", "res-2", "res-3"]);
    }
    expect(entries[1]).toEqual({ kind: "row", item: resOther });
  });

  it("まとまりの中は申請日時の古い順に並ぶ", () => {
    // 一覧上の並びや開始日時に関わらず、まとまりの中は requestedAt の古い順
    const resLateReq = createItem({
      id: "res-late",
      startAt: new Date("2026-11-12T01:00:00.000Z"), // 10:00
      endAt: new Date("2026-11-12T03:00:00.000Z"), // 12:00
      requestedAt: new Date("2026-10-05T00:00:00.000Z"), // 後から申請
    });
    const resEarlyReq = createItem({
      id: "res-early",
      startAt: new Date("2026-11-12T01:30:00.000Z"), // 10:30
      endAt: new Date("2026-11-12T03:30:00.000Z"), // 12:30
      requestedAt: new Date("2026-10-01T00:00:00.000Z"), // 先に申請
    });

    const entries = toReservationListEntries([resLateReq, resEarlyReq], true);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("overlap");
    if (entries[0]?.kind === "overlap") {
      expect(entries[0].items.map((i) => i.id)).toEqual(["res-early", "res-late"]);
    }
  });

  it("承認済みの予約は重なっていても行のまま残る", () => {
    const resApproved = createItem({
      id: "res-approved",
      status: ReservationStatus.Approved,
      startAt: new Date("2026-11-12T01:00:00.000Z"),
      endAt: new Date("2026-11-12T03:00:00.000Z"),
    });
    const resProvisional = createItem({
      id: "res-provisional",
      status: ReservationStatus.Provisional,
      startAt: new Date("2026-11-12T01:00:00.000Z"),
      endAt: new Date("2026-11-12T03:00:00.000Z"),
    });

    const entries = toReservationListEntries([resApproved, resProvisional], true);

    expect(entries).toEqual([
      { kind: "row", item: resApproved },
      { kind: "row", item: resProvisional },
    ]);
  });

  it("重なる相手の無い仮予約は行のまま残る", () => {
    const resAlone = createItem({
      id: "res-alone",
      status: ReservationStatus.Provisional,
    });

    const entries = toReservationListEntries([resAlone], true);

    expect(entries).toEqual([{ kind: "row", item: resAlone }]);
  });

  it("2 つのまとまりが別々の位置に作られる", () => {
    // まとまり A (10〜12時、11〜13時)
    const resA1 = createItem({
      id: "res-a1",
      startAt: new Date("2026-11-12T01:00:00.000Z"), // 10:00
      endAt: new Date("2026-11-12T03:00:00.000Z"), // 12:00
    });
    const resA2 = createItem({
      id: "res-a2",
      startAt: new Date("2026-11-12T02:00:00.000Z"), // 11:00
      endAt: new Date("2026-11-12T04:00:00.000Z"), // 13:00
    });

    // 独立した行
    const resMiddle = createItem({
      id: "res-middle",
      startAt: new Date("2026-11-12T05:00:00.000Z"), // 14:00
      endAt: new Date("2026-11-12T06:00:00.000Z"), // 15:00
    });

    // まとまり B (16〜18時、17〜19時)
    const resB1 = createItem({
      id: "res-b1",
      startAt: new Date("2026-11-12T07:00:00.000Z"), // 16:00
      endAt: new Date("2026-11-12T09:00:00.000Z"), // 18:00
    });
    const resB2 = createItem({
      id: "res-b2",
      startAt: new Date("2026-11-12T08:00:00.000Z"), // 17:00
      endAt: new Date("2026-11-12T10:00:00.000Z"), // 19:00
    });

    const entries = toReservationListEntries([resA1, resMiddle, resA2, resB1, resB2], true);

    expect(entries).toHaveLength(3);
    expect(entries[0]?.kind).toBe("overlap");
    if (entries[0]?.kind === "overlap") {
      expect(entries[0].items.map((i) => i.id)).toEqual(["res-a1", "res-a2"]);
    }
    expect(entries[1]).toEqual({ kind: "row", item: resMiddle });
    expect(entries[2]?.kind).toBe("overlap");
    if (entries[2]?.kind === "overlap") {
      expect(entries[2].items.map((i) => i.id)).toEqual(["res-b1", "res-b2"]);
    }
  });
});
