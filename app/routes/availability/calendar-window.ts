import { DAYS_IN_WEEK, type AvailabilityDay } from "~/components/reservation/availability-week";
import { addDays, parseTokyoDateKey, startOfTokyoWeek, toTokyoDateKey } from "~/lib/date";
import type { AvailabilityPeriods } from "~/query/facility/facility-availability-calendar";

import type { ParsedCalendarSelection } from "./paths";

/**
 * 空き状況カレンダーで 1 度に読み込んで保持する日数（4 週間）。
 *
 * 3 週間ではなく 4 週間にしているのは、読み直した直後に端に達して
 * もう一度読み直しが起きないようにするため（ADR-014 決定 4）。
 */
export const CALENDAR_WINDOW_DAYS = 28;

/**
 * 読み込む範囲の開始日を返す。
 *
 * 基準の日を含む週の日曜（startOfTokyoWeek）の 7 日前（前の週の日曜）。
 */
export const toCalendarWindowStart = (anchor: Date): Date =>
  addDays(startOfTokyoWeek(anchor), -DAYS_IN_WEEK);

/** その日（日本時間の 0 時）が、`windowStart` から読む 4 週間の中にあるか */
export const isInCalendarWindow = (windowStart: Date, day: Date): boolean =>
  day.getTime() >= windowStart.getTime() &&
  day.getTime() < addDays(windowStart, CALENDAR_WINDOW_DAYS).getTime();

/**
 * 欄で開いている仮の枠（申請・変更後）の日が、読み込む 4 週間の外にあれば、その日の 0 時を返す（ADR-014 決定 19）。
 *
 * 4 週間の中にある・仮の枠が無い・予約を開いているときは null。
 * 変更で仮の枠が URL に無いとき（予約の今の日時を使う）も null にする。その日は変更する予約を読むまで分からない。
 */
export const toDraftDayOutsideWindow = (
  windowStart: Date,
  selection: ParsedCalendarSelection | null,
): Date | null => {
  const draft = selection?.kind === "draft" || selection?.kind === "edit" ? selection.draft : null;
  const day = draft === null ? null : parseTokyoDateKey(draft.dateKey);
  return day === null || isInCalendarWindow(windowStart, day) ? null : day;
};

/**
 * 予約を読む期間。4 週間と、その外にある仮の枠の日（ADR-014 決定 19）。
 */
export const toCalendarPeriods = (
  windowStart: Date,
  draftDayOutsideWindow: Date | null,
): AvailabilityPeriods => {
  const calendarWindow = { from: windowStart, to: addDays(windowStart, CALENDAR_WINDOW_DAYS) };
  return draftDayOutsideWindow === null
    ? [calendarWindow]
    : [calendarWindow, { from: draftDayOutsideWindow, to: addDays(draftDayOutsideWindow, 1) }];
};

/**
 * 日付キー（YYYY-MM-DD）に合致する日のインデックスを返す。
 * 見つからない場合は -1 を返す。
 */
export const findDayIndex = (days: readonly AvailabilityDay[], dateKey: string): number =>
  days.findIndex((day) => day.dateKey === dateKey);

/**
 * いま並んでいる日数（1〜7）。時刻の軸を除いた幅 ÷ 1 日の列の幅を四捨五入する。
 *
 * 日数は CSS のコンテナクエリが決めるので、ボタンを押したときなどに DOM で測った値を渡す。
 */
export const toVisibleCount = (daysWidth: number, columnWidth: number): number => {
  // 描く前（幅 0）に呼ばれても 0 で割らない
  if (columnWidth <= 0 || !Number.isFinite(daysWidth) || !Number.isFinite(columnWidth)) {
    return 1;
  }
  return Math.max(1, Math.min(7, Math.round(daysWidth / columnWidth)));
};

/**
 * 先頭にしてよい位置（インデックス）に補正する。
 *
 * 表示日数が 7 なら、index 以前で最も近い日曜の位置（weekday === 0）。
 * それ以外なら index のまま。どちらも 0〜days.length - visibleCount に収める。
 */
export const toAlignedIndex = (
  days: readonly AvailabilityDay[],
  index: number,
  visibleCount: number,
): number => {
  const maxIndex = Math.max(0, days.length - visibleCount);
  let candidate = index;

  if (visibleCount === DAYS_IN_WEEK) {
    candidate = 0;
    for (let i = Math.min(index, days.length - 1); i >= 0; i--) {
      if (days[i]?.weekday === 0) {
        candidate = i;
        break;
      }
    }
  }

  return Math.max(0, Math.min(maxIndex, candidate));
};

/**
 * 指定した日（targetIndex）を見せるための新しい先頭インデックスを返す。
 *
 * - 表示日数が 7: targetIndex の週の日曜（toAlignedIndex）
 * - それ以外:
 *   - すでに見えていれば firstIndex のまま
 *   - 左にはみ出していれば targetIndex（左端に来る）
 *   - 右にはみ出していれば targetIndex - visibleCount + 1（右端に来る）
 * 最後に 0〜days.length - visibleCount に収める。
 */
export const toRevealIndex = (
  days: readonly AvailabilityDay[],
  targetIndex: number,
  firstIndex: number,
  visibleCount: number,
): number => {
  const maxIndex = Math.max(0, days.length - visibleCount);
  let candidate: number;

  if (visibleCount === DAYS_IN_WEEK) {
    candidate = toAlignedIndex(days, targetIndex, DAYS_IN_WEEK);
  } else if (targetIndex >= firstIndex && targetIndex < firstIndex + visibleCount) {
    candidate = firstIndex;
  } else if (targetIndex < firstIndex) {
    candidate = targetIndex;
  } else {
    candidate = targetIndex - visibleCount + 1;
  }

  return Math.max(0, Math.min(maxIndex, candidate));
};

/**
 * 見えている範囲の左右どちらかに、表示日数ぶんの日が残っていなければ true を返す。
 *
 * 端に近づいたときに新しい基準でカレンダーを読み直す判定に使う（ADR-014 決定 4）。
 */
export const needsWindowShift = (
  firstIndex: number,
  visibleCount: number,
  dayCount: number,
): boolean => firstIndex < visibleCount || dayCount - (firstIndex + visibleCount) < visibleCount;

/** 日本時間の年と月。日付キー（YYYY-MM-DD）から取り出す */
const toTokyoYearMonth = (date: Date): { year: number; month: number } => {
  const dateKey = toTokyoDateKey(date);
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)) };
};

/**
 * カレンダーの見出しに表示する年月を日本時間で組み立てる（ADR-014）。
 *
 * - 同じ月: 2026年10月
 * - 月をまたぐ（同年）: 2026年10月〜11月
 * - 年をまたぐ: 2026年12月〜2027年1月
 */
export const formatVisibleMonths = (first: Date, last: Date): string => {
  const firstYM = toTokyoYearMonth(first);
  const lastYM = toTokyoYearMonth(last);

  if (firstYM.year === lastYM.year && firstYM.month === lastYM.month) {
    return `${firstYM.year}年${firstYM.month}月`;
  }
  if (firstYM.year === lastYM.year) {
    return `${firstYM.year}年${firstYM.month}月〜${lastYM.month}月`;
  }
  return `${firstYM.year}年${firstYM.month}月〜${lastYM.year}年${lastYM.month}月`;
};
