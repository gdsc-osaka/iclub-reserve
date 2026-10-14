/**
 * 祝日 1 件の情報。
 */
export interface HolidayItem {
  /** 日付（"YYYY-MM-DD" 形式） */
  readonly date: string;
  /** 祝日名（画面には出さないが、ログや調査のために残す） */
  readonly name: string;
}

/**
 * Google カレンダーの日本の祝日 iCal 文字列から、祝日の一覧を抽出する純粋関数。
 *
 * 【仕様】
 * - iCal の行折り返し（RFC 5545: CRLF または LF + 空白/タブ）を解除してから解析する。
 * - 改行コードは CRLF と LF の両方に対応する。
 * - `DESCRIPTION:祝日` の VEVENT のみを祝日として抽出する（節分・七夕などの祭日は DESCRIPTION が "祭日\n..." となっているため除外される）。
 * - 振替休日も DESCRIPTION が "祝日" であれば含まれる。
 * - 同一日付に複数のイベントがある場合は、最初に見つかったものを採用して 1 つにまとめる。
 * - 日付（"YYYY-MM-DD"）の昇順で並び替えて返す。
 * - VEVENT が 1 つも無い場合は空配列を返す。
 *
 * @param icalText iCal 形式の文字列
 * @returns 日付昇順の祝日配列
 */
export const toHolidayListFromIcal = (icalText: string): readonly HolidayItem[] => {
  // 1. iCal の行折り返し（RFC 5545）を解除
  // 行頭のスペースまたはタブが直前の行の継続を表す
  const unfolded = icalText.replace(/\r?\n[ \t]/g, "");

  // 2. 改行で行に分割
  const lines = unfolded.split(/\r?\n/);

  const holidaysByDate = new Map<string, string>();
  let inEvent = false;
  let currentDate: string | null = null;
  let currentSummary: string | null = null;
  let currentDescription: string | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      currentDate = null;
      currentSummary = null;
      currentDescription = null;
      continue;
    }

    if (line === "END:VEVENT") {
      if (inEvent && currentDescription === "祝日" && currentDate && currentSummary) {
        // 同じ日付は 1 つにまとめる
        if (!holidaysByDate.has(currentDate)) {
          holidaysByDate.set(currentDate, currentSummary);
        }
      }
      inEvent = false;
      currentDate = null;
      currentSummary = null;
      currentDescription = null;
      continue;
    }

    if (!inEvent) continue;

    if (line.startsWith("DTSTART")) {
      // 例: DTSTART;VALUE=DATE:20250211 または DTSTART:20250211
      const match = line.match(/:(\d{4})(\d{2})(\d{2})/);
      if (match) {
        currentDate = `${match[1]}-${match[2]}-${match[3]}`;
      }
    } else if (line.startsWith("SUMMARY:")) {
      currentSummary = line.slice("SUMMARY:".length).trim();
    } else if (line.startsWith("DESCRIPTION:")) {
      currentDescription = line.slice("DESCRIPTION:".length).trim();
    }
  }

  return Array.from(holidaysByDate.entries())
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
};
