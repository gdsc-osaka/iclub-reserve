/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { HolidayRepository } from "~/domain/holiday/repository";
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
