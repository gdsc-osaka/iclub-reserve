import { describe, expect, it } from "vite-plus/test";

import {
  differsOnlyInSelection,
  parseCalendarSelection,
  parseDraftParam,
  toCalendarPath,
  toDraftParam,
  type CalendarDraft,
  type CalendarSelection,
} from "./paths";

describe("availability paths", () => {
  describe("toDraftParam", () => {
    it("仮の枠を YYYY-MM-DDTHH:MM-HH:MM の文字列にする", () => {
      const draft: CalendarDraft = {
        dateKey: "2026-11-04",
        range: { startMinutes: 10 * 60, endMinutes: 11 * 60 },
      };
      expect(toDraftParam(draft)).toBe("2026-11-04T10:00-11:00");
    });

    it("range が null の仮の枠は日付だけ（YYYY-MM-DD）の文字列にする", () => {
      const draft: CalendarDraft = {
        dateKey: "2026-11-04",
        range: null,
      };
      expect(toDraftParam(draft)).toBe("2026-11-04");
    });
  });

  describe("parseDraftParam", () => {
    it("日付だけの draft パラメータをパースする（range は null）", () => {
      const result = parseDraftParam("2026-11-04");
      expect(result).toEqual({
        dateKey: "2026-11-04",
        range: null,
      });
    });

    it("日付だけの場合でも壊れた日付は null を返す", () => {
      expect(parseDraftParam("2026-02-30")).toBeNull();
      expect(parseDraftParam("2026-99-99")).toBeNull();
    });

    it("正常な形式の draft パラメータをパースする", () => {
      const result = parseDraftParam("2026-11-04T10:00-11:00");
      expect(result).toEqual({
        dateKey: "2026-11-04",
        range: { startMinutes: 600, endMinutes: 660 },
      });
    });

    it("null の場合は null を返す", () => {
      expect(parseDraftParam(null)).toBeNull();
    });

    it("形式が合わない文字列は null を返す", () => {
      expect(parseDraftParam("invalid")).toBeNull();
      expect(parseDraftParam("2026-11-04 10:00-11:00")).toBeNull();
      expect(parseDraftParam("2026/11/04T10:00-11:00")).toBeNull();
    });

    it("日付として読めない値は null を返す", () => {
      expect(parseDraftParam("2026-02-30T10:00-11:00")).toBeNull();
    });

    it("開始時刻が 30 分単位の枠に無い場合は null を返す", () => {
      // 10:15 はスロット外
      expect(parseDraftParam("2026-11-04T10:15-11:00")).toBeNull();
      // 開館前 8:30 はスロット外
      expect(parseDraftParam("2026-11-04T08:30-09:30")).toBeNull();
    });

    it("終了時刻が 30 分単位の終了枠に無い場合は null を返す", () => {
      // 10:45 はスロット外
      expect(parseDraftParam("2026-11-04T10:00-10:45")).toBeNull();
      // 閉館後 21:30 はスロット外
      expect(parseDraftParam("2026-11-04T20:00-21:30")).toBeNull();
    });

    it("開始が終了以後の場合は null を返す", () => {
      expect(parseDraftParam("2026-11-04T11:00-10:00")).toBeNull();
      expect(parseDraftParam("2026-11-04T10:00-10:00")).toBeNull();
    });
  });

  describe("parseCalendarSelection", () => {
    it("reservation があれば予約の選択を返す", () => {
      const params = new URLSearchParams("reservation=res_123");
      expect(parseCalendarSelection(params)).toEqual({
        kind: "reservation",
        reservationId: "res_123",
      });
    });

    it("draft があれば仮の枠の選択を返す", () => {
      const params = new URLSearchParams("draft=2026-11-04T10:00-11:00");
      expect(parseCalendarSelection(params)).toEqual({
        kind: "draft",
        draft: {
          dateKey: "2026-11-04",
          range: { startMinutes: 600, endMinutes: 660 },
        },
      });
    });

    it("両方ある場合は reservation を優先する", () => {
      const params = new URLSearchParams("reservation=res_123&draft=2026-11-04T10:00-11:00");
      expect(parseCalendarSelection(params)).toEqual({
        kind: "reservation",
        reservationId: "res_123",
      });
    });

    it("reservation が空文字の場合は draft を読む", () => {
      const params = new URLSearchParams("reservation=&draft=2026-11-04T10:00-11:00");
      expect(parseCalendarSelection(params)).toEqual({
        kind: "draft",
        draft: {
          dateKey: "2026-11-04",
          range: { startMinutes: 600, endMinutes: 660 },
        },
      });
    });

    it("どちらも無ければ null を返す", () => {
      expect(parseCalendarSelection(new URLSearchParams())).toBeNull();
    });
  });

  describe("toCalendarPath", () => {
    it("施設と基準の日だけの URL を作る", () => {
      expect(toCalendarPath("fac_1", "2026-11-04")).toBe(
        "/availability?facility=fac_1&date=2026-11-04",
      );
    });

    it("facilityId が null のときは facility を付けない", () => {
      expect(toCalendarPath(null, "2026-11-04")).toBe("/availability?date=2026-11-04");
    });

    it("予約を開くときは、ID を encodeURIComponent して reservation に付ける", () => {
      const selection: CalendarSelection = {
        kind: "reservation",
        reservationId: "res/special 123",
      };
      expect(toCalendarPath("fac_1", "2026-11-04", selection)).toBe(
        "/availability?facility=fac_1&date=2026-11-04&reservation=res%2Fspecial%20123",
      );
    });

    it("仮の枠を開くときは、: を %3A にせずに draft に付ける", () => {
      const selection: CalendarSelection = {
        kind: "draft",
        draft: { dateKey: "2026-11-04", range: { startMinutes: 600, endMinutes: 660 } },
      };
      expect(toCalendarPath("fac_1", "2026-11-04", selection)).toBe(
        "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00",
      );
    });
  });

  describe("differsOnlyInSelection", () => {
    it("date が違う場合は false を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04");
      const b = new URLSearchParams("facility=fac_1&date=2026-11-11");
      expect(differsOnlyInSelection(a, b)).toBe(false);
    });

    it("facility が違う場合は false を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04");
      const b = new URLSearchParams("facility=fac_2&date=2026-11-04");
      expect(differsOnlyInSelection(a, b)).toBe(false);
    });

    it("draft だけ違う場合は true を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00");
      const b = new URLSearchParams("facility=fac_1&date=2026-11-04&draft=2026-11-04T11:00-12:00");
      expect(differsOnlyInSelection(a, b)).toBe(true);
    });

    it("reservation を足しただけの場合は true を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04");
      const b = new URLSearchParams("facility=fac_1&date=2026-11-04&reservation=res_1");
      expect(differsOnlyInSelection(a, b)).toBe(true);
    });

    it("値の順番だけ違う場合は true を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04");
      const b = new URLSearchParams("date=2026-11-04&facility=fac_1");
      expect(differsOnlyInSelection(a, b)).toBe(true);
    });

    it("クエリが空同士でも true を返す", () => {
      expect(differsOnlyInSelection(new URLSearchParams(), new URLSearchParams())).toBe(true);
    });

    it("reservation から draft に切り替わった場合も true を返す", () => {
      const a = new URLSearchParams("facility=fac_1&date=2026-11-04&reservation=res_1");
      const b = new URLSearchParams("facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00");
      expect(differsOnlyInSelection(a, b)).toBe(true);
    });
  });
});
