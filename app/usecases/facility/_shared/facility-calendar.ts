import { err, ok, type ResultAsync } from "neverthrow";
import { isRetryableCalendarError, type CalendarClient } from "~/domain/calendar";
import { FacilityErrorCode, FacilityField, type FacilityError } from "~/domain/facility";

export interface EnsureCalendarWritableArgs {
  readonly calendarClient: CalendarClient;
  readonly googleCalendarId: string;
  readonly calendarWriterEmail: string | null;
}

/**
 * Google Calendar ID に書き込み権限があるかを確かめる門番（COND-025）。
 *
 * 施設の新規登録や更新で Calendar ID を設定・変更するときに呼び出す。
 * 書き込めない場合やカレンダーが存在しない場合は FacilityErrorCode.CalendarNotWritable、
 * 一時的な通信障害の場合は FacilityErrorCode.CalendarUnavailable、
 * 認証エラー等の設定不備は FacilityErrorCode.CalendarSystemError を返す。
 */
export const ensureCalendarWritable = ({
  calendarClient,
  googleCalendarId,
  calendarWriterEmail,
}: EnsureCalendarWritableArgs): ResultAsync<null, FacilityError> =>
  calendarClient
    .checkWriteAccess(googleCalendarId)
    .mapErr((error): FacilityError => {
      if (isRetryableCalendarError(error)) {
        return {
          code: FacilityErrorCode.CalendarUnavailable,
          field: FacilityField.GoogleCalendarId,
          message: "Google カレンダーへの接続が一時的に利用できない。",
          userMessage:
            "Google カレンダーに接続できませんでした。時間をおいて、もう一度お試しください。",
          cause: error,
        };
      }

      return {
        code: FacilityErrorCode.CalendarSystemError,
        field: FacilityField.GoogleCalendarId,
        message: "カレンダー連携の設定に誤りがあるため確認できなかった。",
        userMessage: "処理を完了できませんでした。時間をおいて、もう一度お試しください。",
        cause: error,
      };
    })
    .andThen((access) => {
      if (access === "writable") {
        return ok(null);
      }

      const userMessage = calendarWriterEmail
        ? `このカレンダーにシステムが予定を書き込めません。Google カレンダーの共有設定で ${calendarWriterEmail} に「予定の変更」の権限を付けてから、もう一度保存してください。`
        : "このカレンダーにシステムが予定を書き込めません。Google カレンダーの共有設定で「予定の変更」の権限を付けてから、もう一度保存してください。";

      return err({
        code: FacilityErrorCode.CalendarNotWritable,
        field: FacilityField.GoogleCalendarId,
        message: "指定された Google カレンダーへの書き込み権限が無いか、カレンダーが存在しない。",
        userMessage,
      });
    });
