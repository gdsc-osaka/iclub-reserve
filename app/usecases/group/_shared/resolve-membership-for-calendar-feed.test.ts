import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vite-plus/test";

import { GroupErrorCode, GroupStatus, type Group } from "~/domain/group";
import { MembershipRole, type StoredMembership } from "~/domain/membership";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { resolveMembershipForCalendarFeed } from "./resolve-membership-for-calendar-feed";

const testGroup: Group = {
  id: "grp_1",
  name: "テスト団体",
  status: GroupStatus.Enabled,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const memberMembership: StoredMembership = {
  id: "mem_1",
  groupId: testGroup.id,
  userId: "usr_member",
  role: MembershipRole.Member,
};

const adminMembership: StoredMembership = {
  id: "mem_2",
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

describe("resolveMembershipForCalendarFeed", () => {
  it("groupId が空文字または空白のみの場合は NotFound を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository(),
      membershipRepository: fakeMembershipRepository(),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: "   ",
      actorUserId: "usr_member",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
  });

  it("所属していない一般利用者には存在秘匿のため NotVisible を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(null),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_outsider",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
  });

  it("所属していない事務局が操作しようとした場合、団体が存在すれば Forbidden を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(null),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_staff",
      isStaff: true,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.Forbidden);
    expect(error.userMessage).toBe("所属していない団体の購読 URL は発行できません。");
  });

  it("事務局であっても団体が存在しない場合は NotFound を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () =>
          errAsync({ code: GroupErrorCode.NotFound, message: "団体が見つからない。" }),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(null),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: "non_existent_group",
      actorUserId: "usr_staff",
      isStaff: true,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
  });

  it("一般メンバー（Member）の所属行を正しく返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(memberMembership),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: testGroup.id,
      actorUserId: memberMembership.userId,
      isStaff: false,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(memberMembership);
  });

  it("管理者（Admin）の所属行を正しく返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(adminMembership),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: testGroup.id,
      actorUserId: adminMembership.userId,
      isStaff: false,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(adminMembership);
  });

  it("事務局スタッフでもその団体に所属していれば許可され所属行を返す", async () => {
    const staffMembership: StoredMembership = {
      id: "mem_staff_in_group",
      groupId: testGroup.id,
      userId: "usr_staff_member",
      role: MembershipRole.Member,
    };
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(staffMembership),
      }),
    };

    const result = await resolveMembershipForCalendarFeed(deps, {
      groupId: testGroup.id,
      actorUserId: staffMembership.userId,
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(staffMembership);
  });
});
