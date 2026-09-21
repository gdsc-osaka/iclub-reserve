import { describe, expect, it } from "vitest";

import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import { MembershipRole, StaffRole, type Actor, type Membership } from "~/domain/membership";
import { ensureActorCan, ensureGroupIsVisible } from "./group-authorization";

const membershipOf = (role: MembershipRole): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  role,
});

const actors = {
  所属なし: { isStaff: false, membership: null },
  メンバー: { isStaff: false, membership: membershipOf(MembershipRole.Member) },
  管理者: { isStaff: false, membership: membershipOf(MembershipRole.Admin) },
  事務局: { isStaff: true, membership: null },
} as const satisfies Record<string, Actor>;

describe("ensureGroupIsVisible", () => {
  it("所属していなければ、権限ではなく見つからないことを返す（COND-011）", async () => {
    const result = await ensureGroupIsVisible(actors["所属なし"]);

    // 「権限がない」と返すと、団体 ID を総当たりして存在を確かめられてしまう
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.GroupNotFound);
  });

  it.each(["メンバー", "管理者", "事務局"] as const)("%s は団体を見られる", async (name) => {
    const result = await ensureGroupIsVisible(actors[name]);

    expect(result.isOk()).toBe(true);
  });
});

describe("ensureActorCan", () => {
  it("所属していなければ、操作の種類に関わらず見つからないことを返す（COND-011）", async () => {
    const result = await ensureActorCan(actors["所属なし"], GroupAction.InviteMember);

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.GroupNotFound);
  });

  it("団体は見られるが操作が許されていなければ、何が足りないかを伝える", async () => {
    const result = await ensureActorCan(actors["メンバー"], GroupAction.InviteMember);
    const error = result._unsafeUnwrapErr();

    expect(error.code).toBe(GroupErrorCode.GroupForbidden);
    expect(error.message).toBe("メンバーを招待できるのは管理者と事務局だけです。");
  });

  it.each(["管理者", "事務局"] as const)("%s はメンバーを招待できる", async (name) => {
    const result = await ensureActorCan(actors[name], GroupAction.InviteMember);

    expect(result.isOk()).toBe(true);
  });
});

/**
 * resolveGroupActor が事務局のときに所属を引かない前提の検証。
 *
 * 事務局の行が他の役割の行をすべて含んでいるあいだは、事務局の人の所属を
 * 足しても許される操作が増えないので、DB への往復を省いてよい。
 * 事務局にだけ許さない操作を作ると、この前提は崩れる。
 */
describe("事務局の行は他の役割の行をすべて含む", () => {
  it.each([MembershipRole.Admin, MembershipRole.Member])(
    "%s に許される操作は、すべて事務局にも許される",
    (role) => {
      const staffActions = groupPermissions.byRole[StaffRole];

      for (const action of groupPermissions.byRole[role]) {
        expect(staffActions).toContain(action);
      }
    },
  );
});
