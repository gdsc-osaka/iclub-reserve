import { describe, expect, it } from "vitest";

import { toCalendarPathFromFormQuery, toFormPathForFacility } from "./paths";

describe("paths", () => {
  describe("toFormPathForFacility", () => {
    it("施設 ID だけを指定した申請フォームのパスを組み立てる", () => {
      expect(toFormPathForFacility("fac_1")).toBe("/reservations/new?facility=fac_1");
    });
  });

  describe("toCalendarPathFromFormQuery", () => {
    const todayKey = "2026-10-26";

    it("クエリパラメータが何も無いときは、施設なし・今日・日付だけの仮の枠になる", () => {
      const params = new URLSearchParams();
      expect(toCalendarPathFromFormQuery(params, todayKey)).toBe(
        "/availability?date=2026-10-26&draft=2026-10-26",
      );
    });

    it("施設・日付・開始・終了がすべて揃っているときはそのまま反映される", () => {
      const params = new URLSearchParams(
        "facility=fac_1&date=2026-11-04&start=10:00&end=11:00&mode=direct&created=res_123",
      );
      expect(toCalendarPathFromFormQuery(params, todayKey)).toBe(
        "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00",
      );
    });

    it("開始だけ、または時刻が壊れているときは時刻なし（日付だけの仮の枠）になる", () => {
      const paramsStartOnly = new URLSearchParams("facility=fac_1&date=2026-11-04&start=10:00");
      expect(toCalendarPathFromFormQuery(paramsStartOnly, todayKey)).toBe(
        "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04",
      );

      const paramsInvalidTime = new URLSearchParams(
        "facility=fac_1&date=2026-11-04&start=10:15&end=11:00",
      );
      expect(toCalendarPathFromFormQuery(paramsInvalidTime, todayKey)).toBe(
        "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04",
      );
    });

    it("日付が壊れているときは今日になる", () => {
      const paramsInvalidDate = new URLSearchParams("facility=fac_1&date=not-a-date");
      expect(toCalendarPathFromFormQuery(paramsInvalidDate, todayKey)).toBe(
        "/availability?facility=fac_1&date=2026-10-26&draft=2026-10-26",
      );
    });
  });
});
