/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { GroupRepository } from "~/domain/group";
import type { GroupInvitationListQuery } from "~/query/group/group-invitation-list";
import type { GroupMemberListQuery } from "~/query/group/group-member-list";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の GroupRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeGroupRepository(overrides: Partial<GroupRepository> = {}): GroupRepository {
  return createUnimplementedFake("GroupRepository", overrides);
}

/**
 * テスト用の GroupMemberListQuery の偽物を生成する。
 */
export function fakeGroupMemberListQuery(
  overrides: Partial<GroupMemberListQuery> = {},
): GroupMemberListQuery {
  return createUnimplementedFake("GroupMemberListQuery", overrides);
}

/**
 * テスト用の GroupInvitationListQuery の偽物を生成する。
 */
export function fakeGroupInvitationListQuery(
  overrides: Partial<GroupInvitationListQuery> = {},
): GroupInvitationListQuery {
  return createUnimplementedFake("GroupInvitationListQuery", overrides);
}
