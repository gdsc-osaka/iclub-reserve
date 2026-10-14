/**
 * 予約申請フォーム（SCR-002）が行き来する URL。
 *
 * 施設と日付はクエリで持ち回る。組み立て方が散らばると、
 * どちらか片方だけ付け忘れたリンクが混ざるので、必ずここを通す。
 */

/** 空き状況カレンダー（SCR-001）の URL を組み立てる */
export const toCalendarPath = (facilityId: string, dateKey: string): string =>
  `/availability?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;

/**
 * 施設だけを選んだ状態でこの画面を開く URL。日付は画面の既定（今日）になる。
 *
 * 却下された予約から「別の日時で申請」するときのように、日付を決めずに入るときに使う。
 */
export const toFormPathForFacility = (facilityId: string): string =>
  `/reservations/new?facility=${encodeURIComponent(facilityId)}`;

/** この画面の URL を組み立てる。施設と日付を持ち回るので、リンクは必ずここを通す */
export const toFormPath = (facilityId: string, dateKey: string, mode?: "direct"): string => {
  const base = `/reservations/new?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;
  return mode === "direct" ? `${base}&mode=direct` : base;
};
