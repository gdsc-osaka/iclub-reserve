import { ErrorKind, type BaseError } from "~/domain/error";

/**
 * 祝日ドメインのエラーコード。
 *
 * 文字列の値に HOLIDAY_ を付けてログ上で見分ける（ADR-004 決定 1）。
 */
export const HolidayErrorCode = {
  /** iCal データの取得失敗 */
  FetchFailed: "HOLIDAY_FETCH_FAILED",
  /** 読み解いた祝日データが 0 件 */
  EmptyHolidays: "HOLIDAY_EMPTY",
  /** 祝日テーブルの読み書き失敗 */
  DatabaseError: "HOLIDAY_DATABASE_ERROR",
} as const;
export type HolidayErrorCode = (typeof HolidayErrorCode)[keyof typeof HolidayErrorCode];

/**
 * HolidayErrorCode から ErrorKind への写像（ADR-004 決定 3）。
 */
export const holidayErrorKind: Record<HolidayErrorCode, ErrorKind> = {
  [HolidayErrorCode.FetchFailed]: ErrorKind.Internal,
  [HolidayErrorCode.EmptyHolidays]: ErrorKind.Internal,
  [HolidayErrorCode.DatabaseError]: ErrorKind.Internal,
};

/**
 * 祝日ドメインのエラー。
 */
export interface HolidayError extends BaseError {
  readonly code: HolidayErrorCode;
}
