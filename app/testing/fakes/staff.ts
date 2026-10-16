/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { StaffInvitationRepository, StaffMemberRepository } from "~/domain/staff";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の StaffInvitationRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeStaffInvitationRepository(
  overrides: Partial<StaffInvitationRepository> = {},
): StaffInvitationRepository {
  return createUnimplementedFake("StaffInvitationRepository", overrides);
}

/**
 * テスト用の StaffMemberRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeStaffMemberRepository(
  overrides: Partial<StaffMemberRepository> = {},
): StaffMemberRepository {
  return createUnimplementedFake("StaffMemberRepository", overrides);
}
