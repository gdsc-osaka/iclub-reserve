/**
 * 自団体の予約カレンダー配信（iCal）のドメイン定義と変換処理（ADR-013 決定 5 / COND-029）。
 */

import { addDays } from "~/lib/date";
import { escapeIcalText, formatIcalDateTimeUtc, formatIcalDocument } from "~/lib/ical";
import { reservationDetailPath, ReservationStatus } from "../reservation";

/** 過去に遡って配信に含める日数（COND-029(2)） */
export const GROUP_CALENDAR_FEED_SINCE_DAYS = 90;

/** 仮予約の予定タイトルに付与する接頭辞（COND-029(3)） */
export const GROUP_CALENDAR_FEED_TENTATIVE_PREFIX = "[仮予約] ";

/** 無効化されたカレンダー配信の名称（COND-029(6)） */
export const GROUP_CALENDAR_FEED_INACTIVE_CALENDAR_NAME = "無効になったカレンダー（i-Club）";

/**
 * 配信対象とする予約の終了日時の下限（90 日前）を算出する純粋関数。
 */
export function toGroupCalendarFeedSince(now: Date): Date {
  return addDays(now, -GROUP_CALENDAR_FEED_SINCE_DAYS);
}

/**
 * 団体名からカレンダーの表示名を組み立てる。
 */
export function toGroupCalendarName(groupName: string): string {
  return `${groupName} の予約（i-Club）`;
}

/**
 * iCal 配信で 1 件の予約を表現する型。
 *
 * 載せるのは仮予約と承認済みの予約だけで、絞り込みは読み取りの側（`findGroupCalendarFeed`）が行う。
 */
export interface GroupCalendarReservation {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly facilityName: string;
  readonly headCount: number;
  readonly remarks: string | null;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly updatedAt: Date;
  /** 施設の更新日時。施設名が予定のタイトルと場所に出るので、予定の最終更新に含める */
  readonly facilityUpdatedAt: Date;
}

/** 予約詳細の URL を組み立てる。baseUrl は末尾にスラッシュの無い origin */
const toReservationDetailUrl = (baseUrl: string, reservationId: string): string =>
  `${baseUrl}${reservationDetailPath(reservationId)}`;

/**
 * 予定の最終更新日時（DTSTAMP・LAST-MODIFIED）を決める。
 *
 * 予約と施設のうち、後に更新された方の日時を使う。施設名を変えただけでも日時が進むので、
 * 最終更新日時で書き換えるかどうかを決めるカレンダーアプリにも、新しい施設名が届く。
 */
const toEventLastModified = (reservation: GroupCalendarReservation): Date =>
  reservation.facilityUpdatedAt.getTime() > reservation.updatedAt.getTime()
    ? reservation.facilityUpdatedAt
    : reservation.updatedAt;

/**
 * 予約 1 件から iCal の説明文（DESCRIPTION）を組み立てる。
 *
 * 備考がある場合:
 * 使用人数: 12 人
 * 備考: <備考>
 *
 * 予約の詳細: <ベースURL>/reservations/<予約ID>
 *
 * 備考がない場合:
 * 使用人数: 12 人
 *
 * 予約の詳細: <ベースURL>/reservations/<予約ID>
 */
export function toGroupCalendarDescription(
  reservation: GroupCalendarReservation,
  baseUrl: string,
): string {
  const detailUrl = toReservationDetailUrl(baseUrl, reservation.id);
  const lines = [`使用人数: ${reservation.headCount} 人`];

  if (reservation.remarks !== null && reservation.remarks.trim() !== "") {
    lines.push(`備考: ${reservation.remarks}`);
  }

  lines.push("");
  lines.push(`予約の詳細: ${detailUrl}`);

  return lines.join("\n");
}

/**
 * 予約一覧から VEVENT ブロックの行配列を生成する純粋関数。
 *
 * 終わった予約は STATUS:CANCELLED としても載せない。読み取りの側で除いてあり、
 * カレンダーアプリが次に読み直したときに手元から消える（COND-029(2)）。
 */
export function toGroupCalendarEvents(
  reservations: readonly GroupCalendarReservation[],
  baseUrl: string,
): readonly string[] {
  const eventLines: string[] = [];

  for (const reservation of reservations) {
    const isTentative = reservation.status === ReservationStatus.Provisional;
    const summaryPrefix = isTentative ? GROUP_CALENDAR_FEED_TENTATIVE_PREFIX : "";
    const summary = `${summaryPrefix}${reservation.facilityName}`;
    const detailUrl = toReservationDetailUrl(baseUrl, reservation.id);
    const description = toGroupCalendarDescription(reservation, baseUrl);
    const lastModified = formatIcalDateTimeUtc(toEventLastModified(reservation));

    eventLines.push(
      "BEGIN:VEVENT",
      `UID:${reservation.id}@iclub-reserve`,
      `DTSTAMP:${lastModified}`,
      `LAST-MODIFIED:${lastModified}`,
      `DTSTART:${formatIcalDateTimeUtc(reservation.startAt)}`,
      `DTEND:${formatIcalDateTimeUtc(reservation.endAt)}`,
      `SUMMARY:${escapeIcalText(summary)}`,
      `LOCATION:${escapeIcalText(reservation.facilityName)}`,
      `DESCRIPTION:${escapeIcalText(description)}`,
      `URL:${detailUrl}`,
      `STATUS:${isTentative ? "TENTATIVE" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  return eventLines;
}

/**
 * カレンダー共通ヘッダー行を生成する。
 */
const toCalendarHeaderLines = (calendarName: string): readonly string[] => [
  "BEGIN:VCALENDAR",
  "PRODID:-//i-Club//iclub-reserve//JA",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
  "X-WR-TIMEZONE:Asia/Tokyo",
  "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  "X-PUBLISHED-TTL:PT1H",
];

/**
 * 団体の予約一覧から iCalendar ドキュメント全体の文字列を生成する。
 */
export function toGroupCalendarFeedIcs(args: {
  readonly groupName: string;
  readonly reservations: readonly GroupCalendarReservation[];
  readonly baseUrl: string;
}): string {
  const calendarName = toGroupCalendarName(args.groupName);
  const headers = toCalendarHeaderLines(calendarName);
  const events = toGroupCalendarEvents(args.reservations, args.baseUrl);
  const footers = ["END:VCALENDAR"];

  return formatIcalDocument([...headers, ...events, ...footers]);
}

/**
 * 予定 0 件の「無効になったカレンダー（i-Club）」iCalendar ドキュメント文字列を生成する。
 *
 * 存在しないトークン・作り直した前のトークン・団体を抜けた人のトークンなど、
 * 無効な要求に対して手元のカレンダーアプリの予定を消去するために返す（COND-029(6)）。
 */
export function toInactiveGroupCalendarFeedIcs(): string {
  const headers = toCalendarHeaderLines(GROUP_CALENDAR_FEED_INACTIVE_CALENDAR_NAME);
  const footers = ["END:VCALENDAR"];

  return formatIcalDocument([...headers, ...footers]);
}
