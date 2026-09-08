import { describe, expect, it } from "vitest";

import { roleCan } from "./authz";
import { GroupAction, groupPermissions } from "./group";
import { canPerform, MembershipRole, toMembershipRoles, type Membership } from "./membership";

/**
 * 役割ごとに許可される操作の期待値。
 *
 * groupPermissions をそのまま参照すると「実装と実装を比べる」ことになり
 * 何も検証できないので、ここには期待する結果を独立して書き下す。
 */
const expected: Record<MembershipRole, Record<GroupAction, boolean>> = {
  [MembershipRole.Admin]: {
    [GroupAction.View]: true,
    [GroupAction.Update]: true,
    [GroupAction.InviteMember]: true,
    [GroupAction.UpdateMemberRole]: true,
    [GroupAction.RemoveMember]: true,
  },
  [MembershipRole.Member]: {
    [GroupAction.View]: true,
    [GroupAction.Update]: false,
    [GroupAction.InviteMember]: false,
    [GroupAction.UpdateMemberRole]: false,
    [GroupAction.RemoveMember]: false,
  },
};

/** 役割と操作のすべての組み合わせ。個別に it を並べると操作を足したとき漏れる */
const combinations = Object.values(MembershipRole).flatMap((role) =>
  Object.values(GroupAction).map((action) => [role, action] as const),
);

const membershipOf = (...roles: MembershipRole[]): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  roles,
});

describe("groupPermissions", () => {
  it.each(combinations)("%s は %s を許可されているか判定できる", (role, action) => {
    expect(roleCan(groupPermissions, role, action)).toBe(expected[role][action]);
  });

  it.each(combinations)("所属していれば %s の %s は役割どおりに判定される", (role, action) => {
    expect(canPerform(groupPermissions, membershipOf(role), action)).toBe(expected[role][action]);
  });

  it.each(Object.values(GroupAction))("所属していなければ %s は許可されない", (action) => {
    expect(canPerform(groupPermissions, null, action)).toBe(false);
  });

  it("役割を複数持つ場合は、いずれかが許可していれば許可される", () => {
    const membership = membershipOf(MembershipRole.Member, MembershipRole.Admin);

    expect(canPerform(groupPermissions, membership, GroupAction.Update)).toBe(true);
    expect(canPerform(groupPermissions, membership, GroupAction.InviteMember)).toBe(true);
  });

  it("知らない役割だけの場合でも閲覧はできる", () => {
    // creatorRole を修正する前に作られた "owner" の行が残っていても、
    // 自分が所属しているグループが見えなくなってはいけない
    const membership = membershipOf(...toMembershipRoles("owner"));

    expect(canPerform(groupPermissions, membership, GroupAction.View)).toBe(true);
    expect(canPerform(groupPermissions, membership, GroupAction.Update)).toBe(false);
  });
});
