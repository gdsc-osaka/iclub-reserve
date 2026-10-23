/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { FacilityRepository } from "~/domain/facility";
import type { FacilityPhotoStorage } from "~/domain/facility/facility-photo";
import type { FacilityCalendarSubscriptionListQuery } from "~/query/facility/facility-calendar-subscription-list";
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
 * テスト用の FacilityCalendarSubscriptionListQuery の偽物を生成する。
 */
export function fakeFacilityCalendarSubscriptionListQuery(
  overrides: Partial<FacilityCalendarSubscriptionListQuery> = {},
): FacilityCalendarSubscriptionListQuery {
  return createUnimplementedFake("FacilityCalendarSubscriptionListQuery", overrides);
}
