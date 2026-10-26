/**
 * 自団体の予約カレンダー購読用 URL の組み立て（ADR-013 決定 6）。
 *
 * baseUrl は末尾にスラッシュの無い origin（`resolveAppBaseUrl` の戻り値）を渡す。
 */

import { toGoogleCalendarAddUrl } from "../facility/facility-input";

/**
 * iCal 形式（https://）の購読 URL を組み立てる。
 */
export function toGroupCalendarFeedUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/calendar-feeds/${token}.ics`;
}

/**
 * カレンダーアプリ直接登録用（webcal://）の購読 URL を組み立てる。
 *
 * http: または https: のスキームを webcal: に置き換える。
 */
export function toGroupCalendarFeedWebcalUrl(baseUrl: string, token: string): string {
  return toGroupCalendarFeedUrl(baseUrl, token).replace(/^https?:/, "webcal:");
}

/**
 * Google カレンダーに追加するためのリンク URL を組み立てる。
 *
 * 施設のカレンダーと同じ toGoogleCalendarAddUrl に webcal:// の URL を渡す。
 * webcal:// の URL は空にならないので、null になることはない。
 */
export function toGroupCalendarFeedGoogleCalendarUrl(
  baseUrl: string,
  token: string,
): string | null {
  return toGoogleCalendarAddUrl(toGroupCalendarFeedWebcalUrl(baseUrl, token));
}
