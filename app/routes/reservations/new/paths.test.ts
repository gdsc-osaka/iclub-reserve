import { describe, expect, it } from "vitest";

import { toCalendarPath, toFormPath, toFormPathForFacility, toFormPathForRange } from "./paths";

describe("paths", () => {
  describe("toCalendarPath", () => {
    it("施設 ID と日付から空き状況カレンダーのパスを組み立てる", () => {
      expect(toCalendarPath("fac_1", "2026-11-04")).toBe(
        "/availability?facility=fac_1&date=2026-11-04",
      );
    });

    it("施設 ID に特殊文字が含まれる場合はエンコードする", () => {
      expect(toCalendarPath("fac/special id", "2026-11-04")).toBe(
        "/availability?facility=fac%2Fspecial%20id&date=2026-11-04",
      );
    });
  });

  describe("toFormPathForFacility", () => {
    it("施設 ID だけを指定した申請フォームのパスを組み立てる", () => {
      expect(toFormPathForFacility("fac_1")).toBe("/reservations/new?facility=fac_1");
    });
  });

  describe("toFormPath", () => {
    it("施設 ID と日付から申請フォームのパスを組み立てる", () => {
      expect(toFormPath("fac_1", "2026-11-04")).toBe(
        "/reservations/new?facility=fac_1&date=2026-11-04",
      );
    });

    it("mode が direct の場合は &mode=direct を付与する", () => {
      expect(toFormPath("fac_1", "2026-11-04", "direct")).toBe(
        "/reservations/new?facility=fac_1&date=2026-11-04&mode=direct",
      );
    });
  });

  describe("toFormPathForRange", () => {
    it("時間帯まで指定した申請フォームのパスを組み立てる", () => {
      const range = { startMinutes: 10 * 60, endMinutes: 11 * 60 };
      expect(toFormPathForRange("fac_1", "2026-11-04", range)).toBe(
        "/reservations/new?facility=fac_1&date=2026-11-04&start=10:00&end=11:00",
      );
    });

    it("mode が direct の場合は &mode=direct を付与する", () => {
      const range = { startMinutes: 13 * 60 + 30, endMinutes: 15 * 60 };
      expect(toFormPathForRange("fac_1", "2026-11-04", range, "direct")).toBe(
        "/reservations/new?facility=fac_1&date=2026-11-04&start=13:30&end=15:00&mode=direct",
      );
    });

    it("施設 ID のみを encodeURIComponent する", () => {
      const range = { startMinutes: 9 * 60, endMinutes: 10 * 60 };
      expect(toFormPathForRange("fac/room a", "2026-11-04", range)).toBe(
        "/reservations/new?facility=fac%2Froom%20a&date=2026-11-04&start=09:00&end=10:00",
      );
    });
  });
});
