import { err, ok, okAsync, type Result, type ResultAsync, safeTry } from "neverthrow";

import {
  HolidayErrorCode,
  toHolidayListFromIcal,
  type HolidayError,
  type HolidayItem,
  type HolidayRepository,
} from "~/domain/holiday";

/** このユースケースが必要とする依存 */
export interface RefreshHolidaysDeps {
  readonly fetchHolidayIcal: () => ResultAsync<string, HolidayError>;
  readonly holidayRepository: HolidayRepository;
}

/** ユースケースの実行結果 */
export interface RefreshHolidaysResult {
  readonly holidayCount: number;
}

/**
 * 読み解いた祝日一覧が空でないことを保証する（門番）。
 *
 * Google の応答が異常な場合に既存の祝日テーブルが空に更新されるのを防ぐ。
 */
const ensureNonEmptyHolidays = (holidays: readonly HolidayItem[]): Result<null, HolidayError> => {
  if (holidays.length === 0) {
    return err({
      code: HolidayErrorCode.EmptyHolidays,
      message:
        "読み解いた日本の祝日データが 0 件でした。既存データを保護するため保存を中止しました。",
    });
  }
  return ok(null);
};

/**
 * 日本の祝日データを外部（Google iCal）から取得し、D1 テーブルに入れ直すユースケース。
 *
 * 【処理の流れ】
 * 1. 外部カレンダーから iCal 文字列を取得（fetchHolidayIcal）
 * 2. iCal 文字列から祝日一覧を読み解く（toHolidayListFromIcal）
 * 3. 祝日が 0 件でないことを確認（ensureNonEmptyHolidays）
 * 4. D1 テーブルを全件削除して新しい祝日一覧を不可分に保存（holidayRepository.replaceAll）
 */
export const refreshHolidaysUseCase = (
  deps: RefreshHolidaysDeps,
): ResultAsync<RefreshHolidaysResult, HolidayError> =>
  safeTry(async function* () {
    // 1. 取得
    const icalText = yield* deps.fetchHolidayIcal();

    // 2. 読み解き
    const holidays = toHolidayListFromIcal(icalText);

    // 3. 0 件チェック（既存データ保護）
    yield* ensureNonEmptyHolidays(holidays);

    // 4. 保存
    yield* deps.holidayRepository.replaceAll(holidays);

    return okAsync({ holidayCount: holidays.length });
  });
