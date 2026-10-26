import { describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import {
  GROUP_CALENDAR_FEED_INACTIVE_CALENDAR_NAME,
  GROUP_CALENDAR_FEED_SINCE_DAYS,
  GROUP_CALENDAR_FEED_TENTATIVE_PREFIX,
  toGroupCalendarFeedSince,
  toGroupCalendarDescription,
  toGroupCalendarEvents,
  toGroupCalendarFeedIcs,
  toGroupCalendarName,
  toInactiveGroupCalendarFeedIcs,
  type GroupCalendarReservation,
} from "./group-calendar-feed";

describe("toGroupCalendarFeedSince", () => {
  it("基準時刻のちょうど 90 日前の Date を返す", () => {
    const now = new Date("2026-04-10T15:00:00.000Z");
    const since = toGroupCalendarFeedSince(now);
    const expectedDiffMs = GROUP_CALENDAR_FEED_SINCE_DAYS * 24 * 60 * 60 * 1000;
    expect(now.getTime() - since.getTime()).toBe(expectedDiffMs);
  });
});

describe("toGroupCalendarName", () => {
  it("団体名を含んだカレンダー表示名を生成する", () => {
    expect(toGroupCalendarName("ロボット工学研究会")).toBe("ロボット工学研究会 の予約（i-Club）");
  });
});

describe("toGroupCalendarDescription", () => {
  const baseReservation: GroupCalendarReservation = {
    id: "res_123",
    status: ReservationStatus.Approved,
    facilityName: "3Dプリンター",
    headCount: 5,
    remarks: null,
    startAt: new Date("2026-05-01T10:00:00.000Z"),
    endAt: new Date("2026-05-01T12:00:00.000Z"),
    updatedAt: new Date("2026-04-01T10:00:00.000Z"),
    facilityUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
  };

  it("備考が無いときは備考の行を出さず、空行を挟んで予約詳細リンクを置く", () => {
    const desc = toGroupCalendarDescription(baseReservation, "https://example.com");
    expect(desc).toBe("使用人数: 5 人\n\n予約の詳細: https://example.com/reservations/res_123");
  });

  it("備考が空文字のときも備考の行を出さない", () => {
    const desc = toGroupCalendarDescription(
      { ...baseReservation, remarks: "   " },
      "https://example.com",
    );
    expect(desc).toBe("使用人数: 5 人\n\n予約の詳細: https://example.com/reservations/res_123");
  });

  it("備考があるときは備考行を含め、備考内の改行もそのまま残す", () => {
    const desc = toGroupCalendarDescription(
      { ...baseReservation, remarks: "部品の試作を行います。\n大型造形です。" },
      "https://example.com",
    );
    expect(desc).toBe(
      "使用人数: 5 人\n備考: 部品の試作を行います。\n大型造形です。\n\n予約の詳細: https://example.com/reservations/res_123",
    );
  });
});

describe("toGroupCalendarEvents", () => {
  const baseReservation: GroupCalendarReservation = {
    id: "res_app1",
    status: ReservationStatus.Approved,
    facilityName: "レーザーカッター",
    headCount: 2,
    remarks: "アクリル板切断",
    startAt: new Date("2026-05-01T01:00:00.000Z"),
    endAt: new Date("2026-05-01T03:00:00.000Z"),
    updatedAt: new Date("2026-04-15T09:00:00.000Z"),
    facilityUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
  };

  it("承認済みの予約は接頭辞なしの SUMMARY と CONFIRMED ステータスになる", () => {
    const lines = toGroupCalendarEvents([baseReservation], "https://example.com");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("UID:res_app1@iclub-reserve");
    expect(lines).toContain("SUMMARY:レーザーカッター");
    expect(lines).toContain("LOCATION:レーザーカッター");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("URL:https://example.com/reservations/res_app1");
    expect(lines).toContain("DTSTART:20260501T010000Z");
    expect(lines).toContain("DTEND:20260501T030000Z");
    expect(lines).toContain("DTSTAMP:20260415T090000Z");
    expect(lines).toContain("LAST-MODIFIED:20260415T090000Z");
    expect(lines).toContain("END:VEVENT");
  });

  it("仮予約は [仮予約] 接頭辞付きの SUMMARY と TENTATIVE ステータスになる", () => {
    const tentative: GroupCalendarReservation = {
      ...baseReservation,
      id: "res_prov1",
      status: ReservationStatus.Provisional,
    };
    const lines = toGroupCalendarEvents([tentative], "https://example.com");
    expect(lines).toContain(`SUMMARY:${GROUP_CALENDAR_FEED_TENTATIVE_PREFIX}レーザーカッター`);
    expect(lines).toContain("STATUS:TENTATIVE");
  });

  it("予約より後に施設が更新されたとき（施設名の変更など）は、施設の更新日時を最終更新日時にする", () => {
    const renamed: GroupCalendarReservation = {
      ...baseReservation,
      facilityName: "レーザー加工機",
      facilityUpdatedAt: new Date("2026-04-20T06:30:00.000Z"),
    };
    const lines = toGroupCalendarEvents([renamed], "https://example.com");
    expect(lines).toContain("SUMMARY:レーザー加工機");
    expect(lines).toContain("DTSTAMP:20260420T063000Z");
    expect(lines).toContain("LAST-MODIFIED:20260420T063000Z");
  });
});

describe("toGroupCalendarFeedIcs", () => {
  it("カレンダーのメタデータとイベントを含んだ iCalendar 文字列を生成する", () => {
    const reservation: GroupCalendarReservation = {
      id: "res_1",
      status: ReservationStatus.Approved,
      facilityName: "会議室",
      headCount: 4,
      remarks: null,
      startAt: new Date("2026-05-01T01:00:00.000Z"),
      endAt: new Date("2026-05-01T02:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      facilityUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
    };

    const ics = toGroupCalendarFeedIcs({
      groupName: "ロボット班",
      reservations: [reservation],
      baseUrl: "https://example.com",
    });

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("X-WR-CALNAME:ロボット班 の予約（i-Club）\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:res_1@iclub-reserve\r\n");
    expect(ics).toContain("END:VEVENT\r\n");
    expect(ics).toContain("END:VCALENDAR\r\n");
  });
});

describe("toInactiveGroupCalendarFeedIcs", () => {
  it("予定 0 件で無効化カレンダー名を持つ iCalendar 文字列を生成する", () => {
    const ics = toInactiveGroupCalendarFeedIcs();

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain(`X-WR-CALNAME:${GROUP_CALENDAR_FEED_INACTIVE_CALENDAR_NAME}\r\n`);
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VCALENDAR\r\n");
  });
});
