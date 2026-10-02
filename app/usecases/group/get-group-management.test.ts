import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { Group, GroupRepository } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { Membership, MembershipRepository } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { QueryErrorCode } from "~/query/error";
import type {
  GroupInvitationList,
  GroupInvitationListQuery,
} from "~/query/group/group-invitation-list";
import type { GroupMemberList, GroupMemberListQuery } from "~/query/group/group-member-list";
import { getGroupManagementUseCase } from "./get-group-management";

const testGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const adminMembership: Membership = {
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const memberMembership: Membership = {
  groupId: testGroup.id,
  userId: "usr_member",
  role: MembershipRole.Member,
};

const testMembers: GroupMemberList = [
  {
    memberId: "mem_1",
    userId: "usr_admin",
    name: "管理者 太郎",
    email: "admin@example.com",
    role: MembershipRole.Admin,
  },
  {
    memberId: "mem_2",
    userId: "usr_member",
    name: "メンバー 次郎",
    email: "member@example.com",
    role: MembershipRole.Member,
  },
];

const testInvitations: GroupInvitationList = [
  {
    id: "inv_1",
    email: "invited@example.com",
    role: MembershipRole.Member,
    expiresAt: new Date("2026-09-22T12:00:00.000Z"),
  },
];

/** D1 を使わないダミーのグループリポジトリ */
const createFakeGroupRepository = (groups: readonly Group[]) => {
  let findByIdCallCount = 0;

  const repository: GroupRepository = {
    findById: (id) => {
      findByIdCallCount += 1;
      const found = groups.find((group) => group.id === id);

      if (found === undefined) {
        return errAsync({
          code: GroupErrorCode.NotFound,
          message: "Group not found",
        });
      }

      return okAsync(found);
    },
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    updateName: () =>
      errAsync({ code: GroupErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateStatus: () =>
      errAsync({ code: GroupErrorCode.DatabaseError, message: "このテストでは使わない" }),
    create: () =>
      errAsync({ code: GroupErrorCode.DatabaseError, message: "このテストでは create は使わない" }),
  };

  return { repository, findByIdCallCount: () => findByIdCallCount };
};

/** D1 を使わないダミーのメンバーシップリポジトリ */
const createFakeMembershipRepository = (memberships: readonly Membership[]) => {
  let callCount = 0;

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      callCount += 1;
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);

      return okAsync(found ?? null);
    },
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  return { repository, callCount: () => callCount };
};

/** D1 を使わないダミーのメンバー一覧 Query */
const createFakeGroupMemberListQuery = (members: GroupMemberList) => {
  let callCount = 0;

  const query: GroupMemberListQuery = {
    findByGroupId: () => {
      callCount += 1;
      return okAsync(members);
    },
  };

  return { query, callCount: () => callCount };
};

/** D1 を使わないダミーの招待一覧 Query */
const createFakeGroupInvitationListQuery = (invitations: GroupInvitationList) => {
  let callCount = 0;

  const query: GroupInvitationListQuery = {
    findByGroupId: () => {
      callCount += 1;
      return okAsync(invitations);
    },
  };

  return { query, callCount: () => callCount };
};

describe("getGroupManagementUseCase", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");

  it("管理者は canManage: true で、メンバーのメールアドレスと招待一覧を受け取れる", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap();
    expect(view.canManage).toBe(true);
    if (view.canManage) {
      expect(view.group).toEqual(testGroup);
      expect(view.members).toEqual(testMembers);
      expect(view.members[0].email).toBe("admin@example.com");
      expect(view.invitations).toEqual(testInvitations);
    }
  });

  it("一般メンバーは canManage: false で、返ってきたメンバーに email が含まれていない", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([memberMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: memberMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap();
    expect(view.canManage).toBe(false);
    if (!view.canManage) {
      expect(view.group).toEqual(testGroup);
      expect(view.members).toHaveLength(testMembers.length);
      // email プロパティが実際に捨てられていることを検証
      for (const m of view.members) {
        expect("email" in m).toBe(false);
      }
      expect(view.members[0]).toEqual({
        memberId: "mem_1",
        userId: "usr_admin",
        name: "管理者 太郎",
        role: MembershipRole.Admin,
      });
    }
  });

  it("一般メンバーには招待一覧を取りに行かない（偽 Query の呼び出し回数が 0）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([memberMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: memberMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(invitationListQuery.callCount()).toBe(0);
  });

  it("事務局（isStaff: true）は所属していなくても canManage: true で取得でき、所属を一度も問い合わせない（偽 Repository の呼び出し回数が 0）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: "usr_staff",
        isStaff: true,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap();
    expect(view.canManage).toBe(true);
    // 事務局は所属を持たないので membershipRepository を問い合わせてはならない
    expect(memberships.callCount()).toBe(0);
    expect(groups.findByIdCallCount()).toBe(1);
  });

  it("所属していない人は NotVisible になり、団体を取りに行かない（呼び出し回数が 0）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: "usr_outsider",
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
    // 存在の有無が問い合わせ回数に現れないよう、団体リポジトリは呼ばれない
    expect(groups.findByIdCallCount()).toBe(0);
    expect(memberListQuery.callCount()).toBe(0);
    expect(invitationListQuery.callCount()).toBe(0);
  });

  it("所属していない団体と存在しない団体で、返るエラーがメッセージまで含めて完全に一致する", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const deps = {
      groupRepository: groups.repository,
      membershipRepository: memberships.repository,
      groupMemberListQuery: memberListQuery.query,
      groupInvitationListQuery: invitationListQuery.query,
    };

    // 存在するが所属していない団体
    const notMember = await getGroupManagementUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_outsider",
      isStaff: false,
      now: baseNow,
    });

    // そもそも存在しない団体
    const notExists = await getGroupManagementUseCase(deps, {
      groupId: "grp_does_not_exist",
      actorUserId: "usr_outsider",
      isStaff: false,
      now: baseNow,
    });

    expect(notMember._unsafeUnwrapErr()).toEqual(notExists._unsafeUnwrapErr());
    expect(groups.findByIdCallCount()).toBe(0);
  });

  it("所属の取得に失敗したら DATABASE_ERROR（GROUP_NOT_FOUND に潰れないこと）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const failingMembershipRepo: MembershipRepository = {
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "メンバーシップの取得に失敗しました。",
          cause: new Error("DB error"),
        }),
      // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
      countAdmins: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
      updateRole: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
      remove: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    };
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: failingMembershipRepo,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(groups.findByIdCallCount()).toBe(0);
  });

  it("メンバー一覧の取得に失敗したら DATABASE_ERROR", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const failingMemberListQuery: GroupMemberListQuery = {
      findByGroupId: () =>
        errAsync({
          code: QueryErrorCode.DatabaseError,
          message: "メンバー一覧の取得に失敗しました。",
        }),
    };
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: failingMemberListQuery,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
  });

  it("期限切れの招待が一覧から除かれる（now の直前・直後の 2 件で境界を確かめる）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);

    const invitationsWithBoundaries: GroupInvitationList = [
      {
        id: "inv_expired_before",
        email: "expired_before@example.com",
        role: MembershipRole.Member,
        // now より前 (1 ミリ秒前)
        expiresAt: new Date(baseNow.getTime() - 1),
      },
      {
        id: "inv_expired_exact",
        email: "expired_exact@example.com",
        role: MembershipRole.Member,
        // now と同時刻 (expiresAt > now を満たさない)
        expiresAt: new Date(baseNow.getTime()),
      },
      {
        id: "inv_active_after",
        email: "active_after@example.com",
        role: MembershipRole.Member,
        // now より後 (1 ミリ秒後)
        expiresAt: new Date(baseNow.getTime() + 1),
      },
    ];

    const invitationListQuery = createFakeGroupInvitationListQuery(invitationsWithBoundaries);

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap();
    expect(view.canManage).toBe(true);
    if (view.canManage) {
      expect(view.invitations).toHaveLength(1);
      expect(view.invitations[0].id).toBe("inv_active_after");
    }
  });

  it.each(["", "   "])(
    "groupId が %o のときは何も問い合わせずに GROUP_NOT_FOUND",
    async (groupId) => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([adminMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
        },
        {
          groupId,
          actorUserId: adminMembership.userId,
          isStaff: false,
          now: baseNow,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
      expect(memberships.callCount()).toBe(0);
      expect(groups.findByIdCallCount()).toBe(0);
      expect(memberListQuery.callCount()).toBe(0);
      expect(invitationListQuery.callCount()).toBe(0);
    },
  );
});
