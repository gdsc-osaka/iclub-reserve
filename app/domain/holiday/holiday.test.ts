import { describe, expect, it } from "vitest";

import { toHolidayListFromIcal } from "./holiday";

describe("toHolidayListFromIcal", () => {
  it("祝日と祭日が混ざっていても祝日だけが返る", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250505
SUMMARY:こどもの日
DESCRIPTION:祝日
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250707
SUMMARY:七夕
DESCRIPTION:祭日\\n祭日を非表示にするには、Google カレンダーの設定に移動してください
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250101
SUMMARY:元日
DESCRIPTION:祝日
END:VEVENT
END:VCALENDAR`;

    const holidays = toHolidayListFromIcal(ical);

    // 七夕（祭日）は除外され、元日とこどもの日が日付昇順で返る
    expect(holidays).toEqual([
      { date: "2025-01-01", name: "元日" },
      { date: "2025-05-05", name: "こどもの日" },
    ]);
  });

  it("行が折り返されていても読める", () => {
    // RFC 5545 の line folding（CRLF + 空白）
    const ical = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20250211\r
SUMM\r
 ARY:建国記念の日\r
DESC\r
 RIPTION:祝日\r
END:VEVENT\r
END:VCALENDAR`;

    const holidays = toHolidayListFromIcal(ical);

    expect(holidays).toEqual([{ date: "2025-02-11", name: "建国記念の日" }]);
  });

  it("CRLF と LF のどちらでも読める", () => {
    const crlfIcal =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20250429\r\nSUMMARY:昭和の日\r\nDESCRIPTION:祝日\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const lfIcal =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20250503\nSUMMARY:憲法記念日\nDESCRIPTION:祝日\nEND:VEVENT\nEND:VCALENDAR";

    expect(toHolidayListFromIcal(crlfIcal)).toEqual([{ date: "2025-04-29", name: "昭和の日" }]);
    expect(toHolidayListFromIcal(lfIcal)).toEqual([{ date: "2025-05-03", name: "憲法記念日" }]);
  });

  it("振替休日が含まれる", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20240211
SUMMARY:建国記念の日
DESCRIPTION:祝日
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20240212
SUMMARY:建国記念の日 振替休日
DESCRIPTION:祝日
END:VEVENT
END:VCALENDAR`;

    const holidays = toHolidayListFromIcal(ical);

    expect(holidays).toEqual([
      { date: "2024-02-11", name: "建国記念の日" },
      { date: "2024-02-12", name: "建国記念の日 振替休日" },
    ]);
  });

  it("VEVENT が 1 つも無いと空配列になる", () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
END:VCALENDAR`;

    expect(toHolidayListFromIcal(ical)).toEqual([]);
    expect(toHolidayListFromIcal("")).toEqual([]);
  });

  it("同じ日付のイベントは 1 つにまとめる", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250101
SUMMARY:元日
DESCRIPTION:祝日
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250101
SUMMARY:元旦
DESCRIPTION:祝日
END:VEVENT
END:VCALENDAR`;

    const holidays = toHolidayListFromIcal(ical);

    expect(holidays).toEqual([{ date: "2025-01-01", name: "元日" }]);
  });
});
