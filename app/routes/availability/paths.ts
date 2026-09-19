import { toTokyoDateKey } from "~/lib/date";

/**
 * 空き状況カレンダー（SCR-001）が行き来する URL。
 *
 * 施設と週はクエリで持ち回る。組み立て方が散らばると、
 * どちらか片方だけ付け忘れたリンクが混ざるので、必ずここを通す。
 */

/** この画面の URL を組み立てる。施設と週を両方持ち回るので、リンクは必ずここを通す */
export const toCalendarPath = (facilityId: string, date: Date): string =>
  `/availability?facility=${encodeURIComponent(facilityId)}&date=${toTokyoDateKey(date)}`;
