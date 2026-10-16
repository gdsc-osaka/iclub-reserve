/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { HolidayRepository } from "~/domain/holiday/repository";
import type { HolidayQuery } from "~/query/holiday/holiday-query";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の HolidayRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeHolidayRepository(
  overrides: Partial<HolidayRepository> = {},
): HolidayRepository {
  return createUnimplementedFake("HolidayRepository", overrides);
}

/**
 * テスト用の HolidayQuery の偽物を生成する。
 */
export function fakeHolidayQuery(overrides: Partial<HolidayQuery> = {}): HolidayQuery {
  return createUnimplementedFake("HolidayQuery", overrides);
}
