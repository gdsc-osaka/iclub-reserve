import { describe, expect, it } from "vite-plus/test";

import {
  toGroupCalendarFeedGoogleCalendarUrl,
  toGroupCalendarFeedUrl,
  toGroupCalendarFeedWebcalUrl,
} from "./group-calendar-feed-url";

describe("group-calendar-feed-url", () => {
  const token = "abcdef_123456";

  it("toGroupCalendarFeedUrl: https://.../calendar-feeds/<token>.ics を返す", () => {
    expect(toGroupCalendarFeedUrl("https://example.com", token)).toBe(
      "https://example.com/calendar-feeds/abcdef_123456.ics",
    );
  });

  it("toGroupCalendarFeedWebcalUrl: http または https を webcal に置き換える", () => {
    expect(toGroupCalendarFeedWebcalUrl("https://example.com", token)).toBe(
      "webcal://example.com/calendar-feeds/abcdef_123456.ics",
    );
    expect(toGroupCalendarFeedWebcalUrl("http://localhost:5173", token)).toBe(
      "webcal://localhost:5173/calendar-feeds/abcdef_123456.ics",
    );
  });

  it("toGroupCalendarFeedGoogleCalendarUrl: webcal の URL をエンコードして Google カレンダー追加 URL を返す", () => {
    const googleUrl = toGroupCalendarFeedGoogleCalendarUrl("https://example.com", token);
    const expectedCid = encodeURIComponent("webcal://example.com/calendar-feeds/abcdef_123456.ics");
    expect(googleUrl).toBe(`https://calendar.google.com/calendar/render?cid=${expectedCid}`);
  });
});
