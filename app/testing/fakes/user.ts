/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type {
  SessionRevoker,
  TermsAcceptanceRepository,
  UserRepository,
  UserSessionRepository,
} from "~/domain/user";
import type { AccountSettingsQuery } from "~/query/user/account-settings";
import type { UserGroupListQuery } from "~/query/user/user-group-list";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の UserRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeUserRepository(overrides: Partial<UserRepository> = {}): UserRepository {
  return createUnimplementedFake("UserRepository", overrides);
}

/**
 * テスト用の TermsAcceptanceRepository の偽物を生成する。
 */
export function fakeTermsAcceptanceRepository(
  overrides: Partial<TermsAcceptanceRepository> = {},
): TermsAcceptanceRepository {
  return createUnimplementedFake("TermsAcceptanceRepository", overrides);
}

/**
 * テスト用の UserSessionRepository の偽物を生成する。
 */
export function fakeUserSessionRepository(
  overrides: Partial<UserSessionRepository> = {},
): UserSessionRepository {
  return createUnimplementedFake("UserSessionRepository", overrides);
}

/**
 * テスト用の SessionRevoker の偽物を生成する。
 */
export function fakeSessionRevoker(overrides: Partial<SessionRevoker> = {}): SessionRevoker {
  return createUnimplementedFake("SessionRevoker", overrides);
}

/**
 * テスト用の AccountSettingsQuery の偽物を生成する。
 */
export function fakeAccountSettingsQuery(
  overrides: Partial<AccountSettingsQuery> = {},
): AccountSettingsQuery {
  return createUnimplementedFake("AccountSettingsQuery", overrides);
}

/**
 * テスト用の UserGroupListQuery の偽物を生成する。
 */
export function fakeUserGroupListQuery(
  overrides: Partial<UserGroupListQuery> = {},
): UserGroupListQuery {
  return createUnimplementedFake("UserGroupListQuery", overrides);
}
