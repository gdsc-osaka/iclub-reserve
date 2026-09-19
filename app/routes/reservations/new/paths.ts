/**
 * 予約申請フォーム（SCR-002）が行き来する URL。
 *
 * 施設と日付はクエリで持ち回る。組み立て方が散らばると、
 * どちらか片方だけ付け忘れたリンクが混ざるので、必ずここを通す。
 */

/** 空き状況カレンダー（SCR-001）の URL を組み立てる */
export const toCalendarPath = (facilityId: string, dateKey: string): string =>
  `/availability?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;

/** この画面の URL を組み立てる。施設と日付を持ち回るので、リンクは必ずここを通す */
export const toFormPath = (facilityId: string, dateKey: string): string =>
  `/reservations/new?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;
