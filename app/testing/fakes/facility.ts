/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { FacilityRepository } from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import type { FacilityAvailabilityCalendarQuery } from "~/query/facility/facility-availability-calendar";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の FacilityRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeFacilityRepository(
  overrides: Partial<FacilityRepository> = {},
): FacilityRepository {
  return createUnimplementedFake("FacilityRepository", overrides);
}

/**
 * テスト用の FacilityPhotoStorage の偽物を生成する。
 */
export function fakeFacilityPhotoStorage(
  overrides: Partial<FacilityPhotoStorage> = {},
): FacilityPhotoStorage {
  return createUnimplementedFake("FacilityPhotoStorage", overrides);
}

/**
 * テスト用の FacilityAvailabilityCalendarQuery の偽物を生成する。
 */
export function fakeFacilityAvailabilityCalendarQuery(
  overrides: Partial<FacilityAvailabilityCalendarQuery> = {},
): FacilityAvailabilityCalendarQuery {
  return createUnimplementedFake("FacilityAvailabilityCalendarQuery", overrides);
}
