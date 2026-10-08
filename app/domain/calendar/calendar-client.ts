import type { ResultAsync } from "neverthrow";
import { ErrorKind, type BaseError } from "~/domain/error";
import type { CalendarEvent, ManagedCalendarEvent } from "./calendar-event";

/**
 * Google Calendar API 操作のエラーコード。
 *
 * 文字列の値に `CALENDAR_` を付けているのは、メールの `MailSendErrorCode`（`AUTH_FAILED` など）と
 * ログの上で見分けるため。一度ログに出たら値は変えないこと（ADR-004 決定 1）。
 */
export const CalendarErrorCode = {
  /** 認証の失敗（Service Account の鍵やメールの誤りなど。再試行しない） */
  AuthFailed: "CALENDAR_AUTH_FAILED",
  /** レート制限または一時的なクォータ超過（403 rateLimitExceeded, 429 など。再試行する） */
  RateLimited: "CALENDAR_RATE_LIMITED",
  /** 権限が無い（書き込み権限が無い、アクセス拒否など。再試行しない） */
  Forbidden: "CALENDAR_FORBIDDEN",
  /** カレンダーまたは予定が見つからない（404 など。再試行しない） */
  NotFound: "CALENDAR_NOT_FOUND",
  /** 一時的に使えない（5xx, 接続断, タイムアウトなど。再試行する） */
  Unavailable: "CALENDAR_UNAVAILABLE",
  /** その他の拒否（不正なリクエスト、パラメータの誤りなど。再試行しない） */
  Rejected: "CALENDAR_REJECTED",
} as const;
export type CalendarErrorCode = (typeof CalendarErrorCode)[keyof typeof CalendarErrorCode];

/**
 * CalendarErrorCode から ErrorKind への写像（ADR-004 決定 3）。
 */
export const calendarErrorKind: Record<CalendarErrorCode, ErrorKind> = {
  [CalendarErrorCode.AuthFailed]: ErrorKind.Internal,
  [CalendarErrorCode.RateLimited]: ErrorKind.Internal,
  [CalendarErrorCode.Forbidden]: ErrorKind.Forbidden,
  [CalendarErrorCode.NotFound]: ErrorKind.NotFound,
  [CalendarErrorCode.Unavailable]: ErrorKind.Internal,
  [CalendarErrorCode.Rejected]: ErrorKind.Internal,
};

/**
 * カレンダー連携のエラー。
 *
 * `field`（どの入力欄の失敗か）は持たせない。このエラーの多くは毎分の同期の中で起き、入力欄が無い。
 * Calendar ID の入力欄に出すかどうかは、施設の画面（`FacilityField.GoogleCalendarId`）の側で決める。
 */
export interface CalendarError extends BaseError {
  readonly code: CalendarErrorCode;
}

/**
 * エラーが一過性のものであり、時間を置いて再試行すべきかを判定する純粋関数。
 *
 * どの層でも同じ基準で再試行可否を判断できるようにドメイン層に置く。
 */
export const isRetryableCalendarError = (error: CalendarError): boolean =>
  error.code === CalendarErrorCode.RateLimited || error.code === CalendarErrorCode.Unavailable;

/**
 * カレンダーの書き込み権限の確認結果。
 *
 * - `writable`: writer または owner 権限があり、予定を書き込める
 * - `not_writable`: 権限が不足している（reader や none など）
 * - `not_found`: 指定されたカレンダーが存在しない
 */
export type CalendarWriteAccess = "writable" | "not_writable" | "not_found";

/**
 * Google Calendar 操作のポート（インターフェース）。
 *
 * ドメイン層に置くことで、UseCase 層は具体的な通信手段や Google API の詳細を知らずに済む。
 */
export interface CalendarClient {
  /** 予定を登録または更新する（存在しなければ新規作成、存在すれば上書き） */
  upsertEvent(event: CalendarEvent): ResultAsync<null, CalendarError>;

  /** 予定を削除する（すでに削除済みの場合は成功とする） */
  deleteEvent(calendarId: string, eventId: string): ResultAsync<null, CalendarError>;

  /**
   * カレンダー内のシステム管理予定をすべて取得する。
   *
   * 終了日時が endAfter 以降の予定を対象とし、他者が作成した予定や別環境の予定は除外する。
   */
  listManagedEvents(
    calendarId: string,
    endAfter: Date,
  ): ResultAsync<ManagedCalendarEvent[], CalendarError>;

  /** カレンダーに対して予定の書き込み権限があるかを確認する */
  checkWriteAccess(calendarId: string): ResultAsync<CalendarWriteAccess, CalendarError>;
}
