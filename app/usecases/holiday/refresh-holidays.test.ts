import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { HolidayErrorCode, type HolidayError } from "~/domain/holiday";
import { fakeHolidayRepository } from "~/testing/fakes/holiday";
import { refreshHolidaysUseCase } from "./refresh-holidays";

const sampleIcal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250101
SUMMARY:元日
DESCRIPTION:祝日
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250113
SUMMARY:成人の日
DESCRIPTION:祝日
END:VEVENT
END:VCALENDAR`;

describe("refreshHolidaysUseCase", () => {
  it("正常系: iCal を取得して読み解き、保存して件数を返す", async () => {
    const fetchHolidayIcal = vi.fn().mockReturnValue(okAsync(sampleIcal));
    const replaceAll = vi.fn().mockReturnValue(okAsync(undefined));
    const holidayRepository = fakeHolidayRepository({ replaceAll });

    const result = await refreshHolidaysUseCase({
      fetchHolidayIcal,
      holidayRepository,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ holidayCount: 2 });
    expect(fetchHolidayIcal).toHaveBeenCalledTimes(1);
    expect(replaceAll).toHaveBeenCalledWith([
      { date: "2025-01-01", name: "元日" },
      { date: "2025-01-13", name: "成人の日" },
    ]);
  });

  it("取得失敗時: 保存を呼ばずにエラーを返す", async () => {
    const fetchError: HolidayError = {
      code: HolidayErrorCode.FetchFailed,
      message: "通信エラー",
    };
    const fetchHolidayIcal = vi.fn().mockReturnValue(errAsync(fetchError));
    const replaceAll = vi.fn();
    const holidayRepository = fakeHolidayRepository({ replaceAll });

    const result = await refreshHolidaysUseCase({
      fetchHolidayIcal,
      holidayRepository,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(fetchError);
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it("祝日が 0 件のとき: 既存データ保護のため保存を呼ばずにエラーで終了する", async () => {
    // 祝日が含まれない iCal（祭日のみ、または VEVENT なし）
    const emptyIcal = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250707
SUMMARY:七夕
DESCRIPTION:祭日
END:VEVENT
END:VCALENDAR`;

    const fetchHolidayIcal = vi.fn().mockReturnValue(okAsync(emptyIcal));
    const replaceAll = vi.fn();
    const holidayRepository = fakeHolidayRepository({ replaceAll });

    const result = await refreshHolidaysUseCase({
      fetchHolidayIcal,
      holidayRepository,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(HolidayErrorCode.EmptyHolidays);
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it("保存失敗時: 保存時のエラーを返す", async () => {
    const dbError: HolidayError = {
      code: HolidayErrorCode.DatabaseError,
      message: "DB エラー",
    };
    const fetchHolidayIcal = vi.fn().mockReturnValue(okAsync(sampleIcal));
    const replaceAll = vi.fn().mockReturnValue(errAsync(dbError));
    const holidayRepository = fakeHolidayRepository({ replaceAll });

    const result = await refreshHolidaysUseCase({
      fetchHolidayIcal,
      holidayRepository,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(dbError);
    expect(replaceAll).toHaveBeenCalledTimes(1);
  });
});
