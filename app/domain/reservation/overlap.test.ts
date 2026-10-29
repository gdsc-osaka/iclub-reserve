import { describe, expect, it } from "vite-plus/test";

import {
  overlapsReservation,
  toOverlapCluster,
  toOverlapClusters,
  toOverlapRejections,
  type OverlapMember,
  type ReservationSlot,
} from "./overlap";

const slot = (facilityId: string, start: string, end: string): ReservationSlot => ({
  facilityId,
  startAt: new Date(start),
  endAt: new Date(end),
});

const member = (
  id: string,
  facilityId: string,
  start: string,
  end: string,
  requestedAt: string,
): OverlapMember => ({
  id,
  facilityId,
  startAt: new Date(start),
  endAt: new Date(end),
  requestedAt: new Date(requestedAt),
});

describe("overlapsReservation", () => {
  it("同じ施設で時間帯が重なれば true を返す", () => {
    const a = slot("fac_1", "2026-10-15T10:00:00+09:00", "2026-10-15T12:00:00+09:00");
    const b = slot("fac_1", "2026-10-15T11:00:00+09:00", "2026-10-15T13:00:00+09:00");
    expect(overlapsReservation(a, b)).toBe(true);
    expect(overlapsReservation(b, a)).toBe(true);
  });

  it("終わりと始まりが同じ時刻なら重ならず false を返す", () => {
    const a = slot("fac_1", "2026-10-15T10:00:00+09:00", "2026-10-15T12:00:00+09:00");
    const b = slot("fac_1", "2026-10-15T12:00:00+09:00", "2026-10-15T14:00:00+09:00");
    expect(overlapsReservation(a, b)).toBe(false);
    expect(overlapsReservation(b, a)).toBe(false);
  });

  it("施設が違えば時間帯が重なっていても false を返す", () => {
    const a = slot("fac_1", "2026-10-15T10:00:00+09:00", "2026-10-15T12:00:00+09:00");
    const b = slot("fac_2", "2026-10-15T10:00:00+09:00", "2026-10-15T12:00:00+09:00");
    expect(overlapsReservation(a, b)).toBe(false);
  });

  it("片方がもう片方を完全に含む場合は true を返す", () => {
    const wide = slot("fac_1", "2026-10-15T10:00:00+09:00", "2026-10-15T14:00:00+09:00");
    const inside = slot("fac_1", "2026-10-15T11:00:00+09:00", "2026-10-15T12:00:00+09:00");
    expect(overlapsReservation(wide, inside)).toBe(true);
    expect(overlapsReservation(inside, wide)).toBe(true);
  });
});

describe("toOverlapClusters", () => {
  it("空の配列を渡すと空の配列を返す", () => {
    expect(toOverlapClusters([])).toEqual([]);
  });

  it("10〜12・11〜13・12〜14 の 3 件が 1 つのまとまりになる（連鎖する重なり）", () => {
    const m1 = member(
      "res_1",
      "fac_1",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
      "2026-10-01T10:00:00+09:00",
    );
    const m2 = member(
      "res_2",
      "fac_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
      "2026-10-02T10:00:00+09:00",
    );
    const m3 = member(
      "res_3",
      "fac_1",
      "2026-10-15T12:00:00+09:00",
      "2026-10-15T14:00:00+09:00",
      "2026-10-03T10:00:00+09:00",
    );

    const clusters = toOverlapClusters([m3, m1, m2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((item) => item.id)).toEqual(["res_1", "res_2", "res_3"]);
  });

  it("まとまり内は申請日時の古い順、同じなら id の順に並べる", () => {
    const m1 = member(
      "res_b",
      "fac_1",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
      "2026-10-01T10:00:00+09:00",
    );
    const m2 = member(
      "res_a",
      "fac_1",
      "2026-10-15T10:30:00+09:00",
      "2026-10-15T12:30:00+09:00",
      "2026-10-01T10:00:00+09:00",
    );
    const m3 = member(
      "res_c",
      "fac_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
      "2026-10-01T11:00:00+09:00",
    );

    const clusters = toOverlapClusters([m3, m1, m2]);
    expect(clusters[0]?.map((item) => item.id)).toEqual(["res_a", "res_b", "res_c"]);
  });

  it("重ならない予約は 1 件だけのまとまりとして返す", () => {
    const m1 = member(
      "res_1",
      "fac_1",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
      "2026-10-01T10:00:00+09:00",
    );
    const m2 = member(
      "res_2",
      "fac_1",
      "2026-10-15T13:00:00+09:00",
      "2026-10-15T15:00:00+09:00",
      "2026-10-02T10:00:00+09:00",
    );

    const clusters = toOverlapClusters([m2, m1]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.map((item) => item.id)).toEqual(["res_1"]);
    expect(clusters[1]?.map((item) => item.id)).toEqual(["res_2"]);
  });

  it("まとまりどうしは先頭（最も古い申請日時）の順に並べる", () => {
    const cluster1A = member(
      "res_c1_a",
      "fac_1",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
      "2026-10-03T10:00:00+09:00",
    );
    const cluster1B = member(
      "res_c1_b",
      "fac_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
      "2026-10-04T10:00:00+09:00",
    );

    const cluster2A = member(
      "res_c2_a",
      "fac_1",
      "2026-10-15T15:00:00+09:00",
      "2026-10-15T17:00:00+09:00",
      "2026-10-01T10:00:00+09:00",
    );
    const cluster2B = member(
      "res_c2_b",
      "fac_1",
      "2026-10-15T16:00:00+09:00",
      "2026-10-15T18:00:00+09:00",
      "2026-10-02T10:00:00+09:00",
    );

    const clusters = toOverlapClusters([cluster1B, cluster2B, cluster1A, cluster2A]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.map((item) => item.id)).toEqual(["res_c2_a", "res_c2_b"]);
    expect(clusters[1]?.map((item) => item.id)).toEqual(["res_c1_a", "res_c1_b"]);
  });
});

describe("toOverlapCluster", () => {
  const m1 = member(
    "res_1",
    "fac_1",
    "2026-10-15T10:00:00+09:00",
    "2026-10-15T12:00:00+09:00",
    "2026-10-01T10:00:00+09:00",
  );
  const m2 = member(
    "res_2",
    "fac_1",
    "2026-10-15T11:00:00+09:00",
    "2026-10-15T13:00:00+09:00",
    "2026-10-02T10:00:00+09:00",
  );
  const m3 = member(
    "res_3",
    "fac_1",
    "2026-10-15T15:00:00+09:00",
    "2026-10-15T17:00:00+09:00",
    "2026-10-03T10:00:00+09:00",
  );

  it("対象の予約を含むまとまりを返す", () => {
    const cluster = toOverlapCluster("res_1", [m1, m2, m3]);
    expect(cluster.map((item) => item.id)).toEqual(["res_1", "res_2"]);
  });

  it("targetId が一覧に無ければ空の配列を返す", () => {
    const cluster = toOverlapCluster("res_none", [m1, m2, m3]);
    expect(cluster).toEqual([]);
  });
});

describe("toOverlapRejections", () => {
  const m1 = member(
    "res_1",
    "fac_1",
    "2026-10-15T10:00:00+09:00",
    "2026-10-15T12:00:00+09:00",
    "2026-10-01T10:00:00+09:00",
  );
  const m2 = member(
    "res_2",
    "fac_1",
    "2026-10-15T11:00:00+09:00",
    "2026-10-15T13:00:00+09:00",
    "2026-10-02T10:00:00+09:00",
  );
  const m3 = member(
    "res_3",
    "fac_1",
    "2026-10-15T12:00:00+09:00",
    "2026-10-15T14:00:00+09:00",
    "2026-10-03T10:00:00+09:00",
  );
  const cluster = [m1, m2, m3];

  it("10〜12 を選ぶと 11〜13 だけを却下対象にする", () => {
    const rejections = toOverlapRejections(m1, cluster);
    expect(rejections.map((item) => item.id)).toEqual(["res_2"]);
  });

  it("11〜13 を選ぶと残りの 2 件（10〜12 と 12〜14）を却下対象にする", () => {
    const rejections = toOverlapRejections(m2, cluster);
    expect(rejections.map((item) => item.id)).toEqual(["res_1", "res_3"]);
  });

  it("12〜14 を選ぶと 11〜13 だけを却下対象にする", () => {
    const rejections = toOverlapRejections(m3, cluster);
    expect(rejections.map((item) => item.id)).toEqual(["res_2"]);
  });

  it("承認する予約自身は却下対象に含まない", () => {
    const rejections = toOverlapRejections(m2, cluster);
    expect(rejections.some((item) => item.id === m2.id)).toBe(false);
  });
});
