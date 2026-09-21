import { describe, expect, it } from "vitest";

import { GroupAction, groupPermissions } from ".";
import { canAct, MembershipRole, type Actor, type Membership } from "../membership";

const membershipOf = (role: MembershipRole): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  role,
});

/** 操作する人の形。COND-007 により、団体での役割は同時に 1 つだけ */
const actors = {
  所属なし: { isStaff: false, membership: null },
  メンバー: { isStaff: false, membership: membershipOf(MembershipRole.Member) },
  管理者: { isStaff: false, membership: membershipOf(MembershipRole.Admin) },
  事務局: { isStaff: true, membership: null },
  事務局かつメンバー: { isStaff: true, membership: membershipOf(MembershipRole.Member) },
  事務局かつ管理者: { isStaff: true, membership: membershipOf(MembershipRole.Admin) },
} as const satisfies Record<string, Actor>;
type ActorName = keyof typeof actors;

/**
 * 操作する人ごとに許可される操作の期待値。
 *
 * groupPermissions をそのまま参照すると「実装と実装を比べる」ことになり
 * 何も検証できないので、ここには期待する結果を独立して書き下す。
 */
const expected: Record<ActorName, Record<GroupAction, boolean>> = {
  // COND-011: 所属していない団体については、存在するかどうかも分からせない
  所属なし: {
    [GroupAction.View]: false,
    [GroupAction.Update]: false,
    [GroupAction.InviteMember]: false,
    [GroupAction.UpdateMemberRole]: false,
    [GroupAction.RemoveMember]: false,
  },
  メンバー: {
    [GroupAction.View]: true,
    [GroupAction.Update]: false,
    [GroupAction.InviteMember]: false,
    [GroupAction.UpdateMemberRole]: false,
    [GroupAction.RemoveMember]: false,
  },
  管理者: {
    [GroupAction.View]: true,
    [GroupAction.Update]: true,
    [GroupAction.InviteMember]: true,
    [GroupAction.UpdateMemberRole]: true,
    [GroupAction.RemoveMember]: true,
  },
  // COND-009: 事務局は所属していない団体でも管理できる
  事務局: {
    [GroupAction.View]: true,
    [GroupAction.Update]: true,
    [GroupAction.InviteMember]: true,
    [GroupAction.UpdateMemberRole]: true,
    [GroupAction.RemoveMember]: true,
  },
  // 事務局の権限と、団体での役割の権限の両方を持つ
  事務局かつメンバー: {
    [GroupAction.View]: true,
    [GroupAction.Update]: true,
    [GroupAction.InviteMember]: true,
    [GroupAction.UpdateMemberRole]: true,
    [GroupAction.RemoveMember]: true,
  },
  事務局かつ管理者: {
    [GroupAction.View]: true,
    [GroupAction.Update]: true,
    [GroupAction.InviteMember]: true,
    [GroupAction.UpdateMemberRole]: true,
    [GroupAction.RemoveMember]: true,
  },
};

/** 操作する人と操作のすべての組み合わせ。個別に it を並べると操作を足したとき漏れる */
const combinations = (Object.keys(actors) as readonly ActorName[]).flatMap((name) =>
  Object.values(GroupAction).map((action) => [name, action] as const),
);

describe("groupPermissions", () => {
  it.each(combinations)("%s は %s を許可されているか判定できる", (name, action) => {
    expect(canAct(groupPermissions, actors[name], action)).toBe(expected[name][action]);
  });
});
