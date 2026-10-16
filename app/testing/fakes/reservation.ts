/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { ReservationRepository } from "~/domain/reservation";
import type { ReservationMessageRepository } from "~/domain/reservation/message";
import type { ReservationReadRepository } from "~/domain/reservation/read";
import type { GroupUnreadUpdatesQuery } from "~/query/reservation/group-unread-updates";
import type { ReservationDetailQuery } from "~/query/reservation/reservation-detail";
import type { ReservationFormQuery } from "~/query/reservation/reservation-form";
import type { ReservationListQuery } from "~/query/reservation/reservation-list";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import type { ReservationMessageListQuery } from "~/query/reservation/reservation-message-list";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の ReservationRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeReservationRepository(
  overrides: Partial<ReservationRepository> = {},
): ReservationRepository {
  return createUnimplementedFake("ReservationRepository", overrides);
}

/**
 * テスト用の ReservationMessageRepository の偽物を生成する。
 */
export function fakeReservationMessageRepository(
  overrides: Partial<ReservationMessageRepository> = {},
): ReservationMessageRepository {
  return createUnimplementedFake("ReservationMessageRepository", overrides);
}

/**
 * テスト用の ReservationReadRepository の偽物を生成する。
 */
export function fakeReservationReadRepository(
  overrides: Partial<ReservationReadRepository> = {},
): ReservationReadRepository {
  return createUnimplementedFake("ReservationReadRepository", overrides);
}

/**
 * テスト用の ReservationDetailQuery の偽物を生成する。
 */
export function fakeReservationDetailQuery(
  overrides: Partial<ReservationDetailQuery> = {},
): ReservationDetailQuery {
  return createUnimplementedFake("ReservationDetailQuery", overrides);
}

/**
 * テスト用の ReservationFormQuery の偽物を生成する。
 */
export function fakeReservationFormQuery(
  overrides: Partial<ReservationFormQuery> = {},
): ReservationFormQuery {
  return createUnimplementedFake("ReservationFormQuery", overrides);
}

/**
 * テスト用の ReservationListQuery の偽物を生成する。
 */
export function fakeReservationListQuery(
  overrides: Partial<ReservationListQuery> = {},
): ReservationListQuery {
  return createUnimplementedFake("ReservationListQuery", overrides);
}

/**
 * テスト用の ReservationMailRecipientsQuery の偽物を生成する。
 */
export function fakeReservationMailRecipientsQuery(
  overrides: Partial<ReservationMailRecipientsQuery> = {},
): ReservationMailRecipientsQuery {
  return createUnimplementedFake("ReservationMailRecipientsQuery", overrides);
}

/**
 * テスト用の ReservationMessageListQuery の偽物を生成する。
 */
export function fakeReservationMessageListQuery(
  overrides: Partial<ReservationMessageListQuery> = {},
): ReservationMessageListQuery {
  return createUnimplementedFake("ReservationMessageListQuery", overrides);
}

/**
 * テスト用の GroupUnreadUpdatesQuery の偽物を生成する。
 */
export function fakeGroupUnreadUpdatesQuery(
  overrides: Partial<GroupUnreadUpdatesQuery> = {},
): GroupUnreadUpdatesQuery {
  return createUnimplementedFake("GroupUnreadUpdatesQuery", overrides);
}
