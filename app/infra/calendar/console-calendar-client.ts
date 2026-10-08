import { okAsync, type ResultAsync } from "neverthrow";
import type {
  CalendarClient,
  CalendarError,
  CalendarEvent,
  CalendarWriteAccess,
  ManagedCalendarEvent,
} from "~/domain/calendar";

/**
 * Google Calendar API を呼び出さず、コンソールにログを出力するだけの CalendarClient。
 *
 * 認証情報が無い環境（ローカル開発など）で利用する。
 */
export const createConsoleCalendarClient = (): CalendarClient => ({
  upsertEvent(event: CalendarEvent): ResultAsync<null, CalendarError> {
    console.info(
      [
        "───── Google Calendar 予定登録/更新（コンソール出力） ─────",
        `Calendar ID : ${event.calendarId}`,
        `Event ID    : ${event.eventId}`,
        `Summary     : ${event.summary}`,
        `Period      : ${event.startAt.toISOString()} 〜 ${event.endAt.toISOString()}`,
        "────────────────────────────────────────────────────────────",
      ].join("\n"),
    );
    return okAsync(null);
  },

  deleteEvent(calendarId: string, eventId: string): ResultAsync<null, CalendarError> {
    console.info(
      [
        "───── Google Calendar 予定削除（コンソール出力） ─────",
        `Calendar ID : ${calendarId}`,
        `Event ID    : ${eventId}`,
        "──────────────────────────────────────────────────────",
      ].join("\n"),
    );
    return okAsync(null);
  },

  listManagedEvents(
    calendarId: string,
    endAfter: Date,
  ): ResultAsync<ManagedCalendarEvent[], CalendarError> {
    console.info(
      `Google Calendar 予定一覧取得（コンソール出力）: calendarId=${calendarId}, endAfter=${endAfter.toISOString()}`,
    );
    return okAsync([]);
  },

  checkWriteAccess(calendarId: string): ResultAsync<CalendarWriteAccess, CalendarError> {
    console.info(`Google Calendar 書込権限確認（コンソール出力）: calendarId=${calendarId}`);
    return okAsync("writable");
  },
});
