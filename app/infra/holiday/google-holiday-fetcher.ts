import { ResultAsync } from "neverthrow";

import { HolidayErrorCode, type HolidayError } from "~/domain/holiday";

/** Google の「日本の祝日」公開カレンダーの iCal URL（認証不要） */
export const GOOGLE_HOLIDAY_ICAL_URL =
  "https://calendar.google.com/calendar/ical/ja.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics";

/**
 * 取得を諦めるまでの時間（ミリ秒）。
 *
 * 指定しないと、Google が応答しないときに日次処理がいつまでも待ち続けてしまう。
 * 取れなければ前日までのデータを使い続けるので、長く待つ意味はない。
 */
const REQUEST_TIMEOUT_MS = 10_000;

export interface FetchHolidayIcalOptions {
  /** HTTP リクエスト用 fetch（テストで差し替え可能） */
  readonly fetchFn?: typeof fetch;
  /** 取得先 URL（テストで差し替え可能） */
  readonly url?: string;
}

/**
 * Google の「日本の祝日」公開カレンダーから iCal 形式の文字列を取得する。
 *
 * @param options.fetchFn テスト用 fetch 関数
 * @param options.url テスト用 URL
 * @returns iCal 文字列、または HolidayError
 */
export const fetchHolidayIcal = (
  options?: FetchHolidayIcalOptions,
): ResultAsync<string, HolidayError> => {
  const fetchFn = options?.fetchFn ?? fetch;
  const url = options?.url ?? GOOGLE_HOLIDAY_ICAL_URL;

  return ResultAsync.fromPromise(
    (async () => {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    })(),
    (cause): HolidayError => ({
      code: HolidayErrorCode.FetchFailed,
      message: "日本の祝日 iCal の取得に失敗しました。",
      cause,
    }),
  );
};
