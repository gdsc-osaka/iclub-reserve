import { describe, expect, it } from "vite-plus/test";

import { buildDays } from "~/components/reservation/availability-week";
import { addDays, toTokyoDateKey } from "~/lib/date";

import {
  CALENDAR_WINDOW_DAYS,
  findDayIndex,
  formatVisibleMonths,
  needsWindowShift,
  toAlignedIndex,
  toCalendarWindowStart,
  toRevealIndex,
  toVisibleCount,
} from "./calendar-window";

describe("calendar-window", () => {
  describe("toCalendarWindowStart", () => {
    it("基準の日を含む週の日曜の 7 日前（前の週の日曜）を返す", () => {
      // 2026-10-28（水）の週の日曜は 2026-10-25 -> 7 日前は 2026-10-18（日）
      const anchorWednesday = new Date("2026-10-28T12:00:00+09:00");
      const start = toCalendarWindowStart(anchorWednesday);
      expect(toTokyoDateKey(start)).toBe("2026-10-18");
    });

    it("基準の日が日曜の場合も、前の週の日曜を返す", () => {
      const anchorSunday = new Date("2026-10-25T00:00:00+09:00");
      const start = toCalendarWindowStart(anchorSunday);
      expect(toTokyoDateKey(start)).toBe("2026-10-18");
    });

    it("基準の日が土曜の場合も、前の週の日曜を返す", () => {
      const anchorSaturday = new Date("2026-10-31T23:59:59+09:00");
      const start = toCalendarWindowStart(anchorSaturday);
      expect(toTokyoDateKey(start)).toBe("2026-10-18");
    });
  });

  describe("findDayIndex", () => {
    const today = new Date("2026-10-28T09:00:00+09:00");
    const windowStart = new Date("2026-10-18T00:00:00+09:00");
    const days = buildDays(windowStart, CALENDAR_WINDOW_DAYS, today, []);

    it("存在する日付キーのインデックスを返す", () => {
      expect(findDayIndex(days, "2026-10-18")).toBe(0);
      expect(findDayIndex(days, "2026-10-28")).toBe(10);
    });

    it("存在しない日付キーの場合は -1 を返す", () => {
      expect(findDayIndex(days, "2026-01-01")).toBe(-1);
    });
  });

  describe("toVisibleCount", () => {
    it("日の列の幅で割って四捨五入する", () => {
      expect(toVisibleCount(700, 100)).toBe(7);
      expect(toVisibleCount(520, 100)).toBe(5);
      expect(toVisibleCount(360, 100)).toBe(4);
      expect(toVisibleCount(250, 100)).toBe(3);
    });

    it("計算結果が 7 を超える場合は 7 に収める", () => {
      expect(toVisibleCount(1000, 100)).toBe(7);
    });

    it("計算結果が 1 未満になる場合は 1 に収める", () => {
      expect(toVisibleCount(40, 100)).toBe(1);
      expect(toVisibleCount(0, 100)).toBe(1);
    });

    it("不正な幅や 0 以下の列幅の場合は 1 を返す", () => {
      expect(toVisibleCount(500, 0)).toBe(1);
      expect(toVisibleCount(500, -10)).toBe(1);
    });
  });

  describe("toAlignedIndex", () => {
    const today = new Date("2026-10-28T09:00:00+09:00");
    const windowStart = new Date("2026-10-18T00:00:00+09:00"); // 日曜
    const days = buildDays(windowStart, CALENDAR_WINDOW_DAYS, today, []);

    it("表示日数が 7 の場合、index 以前で最も近い日曜の位置に揃える", () => {
      // index 10（水曜）以前で最も近い日曜は index 7（2026-10-25）
      expect(toAlignedIndex(days, 10, 7)).toBe(7);
      // index 7（日曜）は 7 のまま
      expect(toAlignedIndex(days, 7, 7)).toBe(7);
      // index 0（日曜）は 0 のまま
      expect(toAlignedIndex(days, 0, 7)).toBe(0);
      // index 3（水曜）以前の日曜は index 0
      expect(toAlignedIndex(days, 3, 7)).toBe(0);
    });

    it("表示日数が 7 以外の場合、index の位置を保つ", () => {
      expect(toAlignedIndex(days, 10, 5)).toBe(10);
      expect(toAlignedIndex(days, 10, 3)).toBe(10);
    });

    it("末尾付近では表示日数分の日が収まるよう上限（days.length - visibleCount）に収める", () => {
      // days.length (28) - 7 = 21
      expect(toAlignedIndex(days, 25, 7)).toBe(21);
      // days.length (28) - 5 = 23
      expect(toAlignedIndex(days, 26, 5)).toBe(23);
    });
  });

  describe("toRevealIndex", () => {
    const today = new Date("2026-10-28T09:00:00+09:00");
    const windowStart = new Date("2026-10-18T00:00:00+09:00"); // 日曜
    const days = buildDays(windowStart, CALENDAR_WINDOW_DAYS, today, []);

    it("表示日数が 7 の場合、targetIndex の週の日曜を返す", () => {
      // targetIndex 10（水曜）を含む週の日曜は index 7
      expect(toRevealIndex(days, 10, 0, 7)).toBe(7);
    });

    it("表示日数が 7 以外で、すでに見えている場合は firstIndex のまま", () => {
      // firstIndex 5、visibleCount 5 -> 5, 6, 7, 8, 9 が見えている
      // targetIndex 7 は見えているので 5 のまま
      expect(toRevealIndex(days, 7, 5, 5)).toBe(5);
    });

    it("表示日数が 7 以外で、左にはみ出している場合は targetIndex が左端に来る", () => {
      // firstIndex 5、visibleCount 5
      // targetIndex 3 は左にはみ出しているので 3 が先頭になる
      expect(toRevealIndex(days, 3, 5, 5)).toBe(3);
    });

    it("表示日数が 7 以外で、右にはみ出している場合は targetIndex が右端に来る", () => {
      // firstIndex 5、visibleCount 5 -> 5〜9 が見えている
      // targetIndex 12 は右にはみ出しているので、12 が右端に来る先頭（12 - 5 + 1 = 8）
      expect(toRevealIndex(days, 12, 5, 5)).toBe(8);
    });

    it("末尾の上限（days.length - visibleCount）を超えない", () => {
      // targetIndex 27、visibleCount 5 -> 27 - 5 + 1 = 23 (max は 28 - 5 = 23)
      expect(toRevealIndex(days, 27, 5, 5)).toBe(23);
    });
  });

  describe("needsWindowShift", () => {
    it("見えている範囲の左右どちらかに表示日数分の日が残っていなければ true", () => {
      // firstIndex が visibleCount 未満（左端に達している）
      expect(needsWindowShift(2, 5, 28)).toBe(true);
      expect(needsWindowShift(4, 5, 28)).toBe(true);

      // 右端の残りが visibleCount 未満（28 - (20 + 5) = 3 < 5）
      expect(needsWindowShift(20, 5, 28)).toBe(true);
    });

    it("十分な余白があれば false", () => {
      // firstIndex 7、visibleCount 5 -> 左余白 7 >= 5、右余白 28 - 12 = 16 >= 5
      expect(needsWindowShift(7, 5, 28)).toBe(false);
    });

    it("読み直した直後には、基準の日が日曜〜土曜のどれでも true にならない", () => {
      const today = new Date("2026-10-28T09:00:00+09:00");
      const sunday = new Date("2026-10-25T00:00:00+09:00");

      for (let offset = 0; offset < 7; offset++) {
        const anchor = addDays(sunday, offset);
        const days = buildDays(toCalendarWindowStart(anchor), CALENDAR_WINDOW_DAYS, today, []);
        const anchorIndex = findDayIndex(days, toTokyoDateKey(anchor));

        // 読み直した直後の先頭は、7 日なら基準の週の日曜、3・5 日なら基準の日
        for (const visibleCount of [3, 5, 7]) {
          const firstIndex = toAlignedIndex(days, anchorIndex, visibleCount);
          expect(needsWindowShift(firstIndex, visibleCount, days.length)).toBe(false);
        }
      }
    });
  });

  describe("formatVisibleMonths", () => {
    it("同じ月なら YYYY年M月 を返す", () => {
      const first = new Date("2026-10-01T00:00:00+09:00");
      const last = new Date("2026-10-31T23:59:59+09:00");
      expect(formatVisibleMonths(first, last)).toBe("2026年10月");
    });

    it("同じ年で月をまたぐなら YYYY年M月〜M月 を返す", () => {
      const first = new Date("2026-10-25T00:00:00+09:00");
      const last = new Date("2026-11-04T00:00:00+09:00");
      expect(formatVisibleMonths(first, last)).toBe("2026年10月〜11月");
    });

    it("年をまたぐなら YYYY年M月〜YYYY年M月 を返す", () => {
      const first = new Date("2026-12-28T00:00:00+09:00");
      const last = new Date("2027-01-03T00:00:00+09:00");
      expect(formatVisibleMonths(first, last)).toBe("2026年12月〜2027年1月");
    });

    it("日本時間（Asia/Tokyo）で年月を判定する", () => {
      // UTC では 2026-09-30T15:00:00Z だが日本時間では 2026-10-01T00:00:00+09:00
      const first = new Date("2026-09-30T15:00:00.000Z");
      const last = new Date("2026-10-05T00:00:00.000Z");
      expect(formatVisibleMonths(first, last)).toBe("2026年10月");
    });
  });
});
