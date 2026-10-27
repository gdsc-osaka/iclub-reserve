import { describe, expect, it, vi } from "vite-plus/test";

import { HolidayErrorCode } from "~/domain/holiday";
import { fetchHolidayIcal, GOOGLE_HOLIDAY_ICAL_URL } from "./google-holiday-fetcher";

describe("fetchHolidayIcal", () => {
  it("正常に iCal テキストを取得できる", async () => {
    const fakeIcal = "BEGIN:VCALENDAR\nEND:VCALENDAR";
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(fakeIcal),
    } as unknown as Response);

    const result = await fetchHolidayIcal({ fetchFn });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(fakeIcal);
    expect(fetchFn).toHaveBeenCalledWith(GOOGLE_HOLIDAY_ICAL_URL, {
      signal: expect.any(AbortSignal),
    });
  });

  it("HTTP status が 2xx 以外の場合は FetchFailed エラーになる", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as unknown as Response);

    const result = await fetchHolidayIcal({ fetchFn });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(HolidayErrorCode.FetchFailed);
  });

  it("fetch が例外を投げた場合は FetchFailed エラーになる", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Network Error"));

    const result = await fetchHolidayIcal({ fetchFn });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(HolidayErrorCode.FetchFailed);
  });
});
