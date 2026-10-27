import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import type { StoredGroupCalendarFeed } from "~/domain/calendar";
import type { Group } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { StoredMembership } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import type { GroupAuditLogItem, GroupAuditLogList } from "~/query/audit-log/group-audit-log-list";
import { QueryErrorCode } from "~/query/error";
import type { GroupInvitationList } from "~/query/group/group-invitation-list";
import type { GroupMemberList } from "~/query/group/group-member-list";
import { fakeGroupAuditLogListQuery } from "~/testing/fakes/audit-log";
import { fakeGroupCalendarFeedRepository } from "~/testing/fakes/calendar";
import {
  fakeGroupInvitationListQuery,
  fakeGroupMemberListQuery,
  fakeGroupRepository,
} from "~/testing/fakes/group";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { getGroupManagementUseCase } from "./get-group-management";

const testGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const adminMembership: StoredMembership = {
  id: "gm_adminMembership",
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const memberMembership: StoredMembership = {
  id: "gm_memberMembership",
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
  const findById = vi.fn((id: string) => {
    const found = groups.find((group) => group.id === id);

    if (found === undefined) {
      return errAsync({
        code: GroupErrorCode.NotFound,
        message: "Group not found",
      });
    }

    return okAsync(found);
  });

  const repository = fakeGroupRepository({ findById });

  return { repository, findById };
};

/** D1 を使わないダミーのメンバーシップリポジトリ */
const createFakeMembershipRepository = (memberships: readonly StoredMembership[]) => {
  const findByGroupAndUser = vi.fn((groupId: string, userId: string) => {
    const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);

    return okAsync(found ?? null);
  });

  const repository = fakeMembershipRepository({ findByGroupAndUser });

  return { repository, findByGroupAndUser };
};

/** D1 を使わないダミーのメンバー一覧 Query */
const createFakeGroupMemberListQuery = (members: GroupMemberList) => {
  const findByGroupId = vi.fn(() => okAsync(members));

  const query = fakeGroupMemberListQuery({ findByGroupId });

  return { query, findByGroupId };
};

/** D1 を使わないダミーの招待一覧 Query */
const createFakeGroupInvitationListQuery = (invitations: GroupInvitationList) => {
  const findByGroupId = vi.fn(() => okAsync(invitations));

  const query = fakeGroupInvitationListQuery({ findByGroupId });

  return { query, findByGroupId };
};

/** D1 を使わないダミーの操作履歴一覧 Query */
const createFakeGroupAuditLogListQuery = (
  auditLogs: GroupAuditLogList = { items: [], hasNextPage: false, userNames: {} },
) => {
  const findByGroupId = vi.fn((_groupId: string, _page: number) => okAsync(auditLogs));

  const query = fakeGroupAuditLogListQuery({ findByGroupId });

  return {
    query,
    findByGroupId,
  };
};

/** D1 を使わないダミーのカレンダー購読リポジトリ */
const createFakeGroupCalendarFeedRepository = (feeds: readonly StoredGroupCalendarFeed[] = []) => {
  const findByMembershipId = vi.fn((membershipId: string) => {
    const found = feeds.find((f) => f.membershipId === membershipId);
    return okAsync(found ?? null);
  });

  const repository = fakeGroupCalendarFeedRepository({ findByMembershipId });

  return { repository, findByMembershipId };
};

describe("getGroupManagementUseCase", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");

  it("管理者は canManage: true で、メンバーのメールアドレスと招待一覧を受け取れる", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
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
      expect(view.auditLogs.items).toEqual([]);
      expect(auditLogListQuery.findByGroupId).toHaveBeenCalledTimes(1);
    }
  });

  it("一般メンバーは canManage: false で、返ってきたメンバーに email が含まれていない", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([memberMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: memberMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
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
      // 一般メンバーのビューには auditLogs が存在しない
      expect("auditLogs" in view).toBe(false);
    }
  });

  it("一般メンバーには招待一覧および操作履歴一覧を取りに行かない（偽 Query の呼び出し回数が 0）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([memberMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: memberMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(invitationListQuery.findByGroupId).not.toHaveBeenCalled();
    expect(auditLogListQuery.findByGroupId).not.toHaveBeenCalled();
  });

  it("事務局（isStaff: true）は所属していなくても canManage: true で取得できる", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: "usr_staff",
        isStaff: true,
        now: baseNow,
        auditLogPage: 1,
      },
    );

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap();
    expect(view.canManage).toBe(true);
    // 事務局でも所属は読む（所属していればカレンダー購読のカードを出すため。ADR-013 決定 6）
    expect(memberships.findByGroupAndUser).toHaveBeenCalledWith(testGroup.id, "usr_staff");
    expect(groups.findById).toHaveBeenCalledTimes(1);
    expect(auditLogListQuery.findByGroupId).toHaveBeenCalledTimes(1);
  });

  it("所属していない人は NotVisible になり、団体を取りに行かない（呼び出し回数が 0）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: "usr_outsider",
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
    // 存在の有無が問い合わせ回数に現れないよう、団体リポジトリは呼ばれない
    expect(groups.findById).not.toHaveBeenCalled();
    expect(memberListQuery.findByGroupId).not.toHaveBeenCalled();
    expect(invitationListQuery.findByGroupId).not.toHaveBeenCalled();
    expect(auditLogListQuery.findByGroupId).not.toHaveBeenCalled();
  });

  it("所属していない団体と存在しない団体で、返るエラーがメッセージまで含めて完全に一致する", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const deps = {
      groupRepository: groups.repository,
      membershipRepository: memberships.repository,
      groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
      groupMemberListQuery: memberListQuery.query,
      groupInvitationListQuery: invitationListQuery.query,
      groupAuditLogListQuery: auditLogListQuery.query,
    };

    // 存在するが所属していない団体
    const notMember = await getGroupManagementUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_outsider",
      isStaff: false,
      now: baseNow,
      auditLogPage: 1,
    });

    // そもそも存在しない団体
    const notExists = await getGroupManagementUseCase(deps, {
      groupId: "grp_does_not_exist",
      actorUserId: "usr_outsider",
      isStaff: false,
      now: baseNow,
      auditLogPage: 1,
    });

    expect(notMember._unsafeUnwrapErr()).toEqual(notExists._unsafeUnwrapErr());
    expect(groups.findById).not.toHaveBeenCalled();
    expect(auditLogListQuery.findByGroupId).not.toHaveBeenCalled();
  });

  it("所属の取得に失敗したら DATABASE_ERROR（GROUP_NOT_FOUND に潰れないこと）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const failingMembershipRepo = fakeMembershipRepository({
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "メンバーシップの取得に失敗しました。",
          cause: new Error("DB error"),
        }),
    });
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: failingMembershipRepo,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(groups.findById).not.toHaveBeenCalled();
  });

  it("メンバー一覧の取得に失敗したら DATABASE_ERROR", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const failingMemberListQuery = fakeGroupMemberListQuery({
      findByGroupId: () =>
        errAsync({
          code: QueryErrorCode.DatabaseError,
          message: "メンバー一覧の取得に失敗しました。",
        }),
    });
    const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

    const result = await getGroupManagementUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: memberships.repository,
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: failingMemberListQuery,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
  });

  it("期限切れの招待が一覧から除かれる（now の直前・直後の 2 件で境界を確かめる）", async () => {
    const groups = createFakeGroupRepository([testGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);
    const memberListQuery = createFakeGroupMemberListQuery(testMembers);
    const auditLogListQuery = createFakeGroupAuditLogListQuery();

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
        groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
        groupMemberListQuery: memberListQuery.query,
        groupInvitationListQuery: invitationListQuery.query,
        groupAuditLogListQuery: auditLogListQuery.query,
      },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        now: baseNow,
        auditLogPage: 1,
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
      const auditLogListQuery = createFakeGroupAuditLogListQuery();

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId,
          actorUserId: adminMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
      expect(memberships.findByGroupAndUser).not.toHaveBeenCalled();
      expect(groups.findById).not.toHaveBeenCalled();
      expect(memberListQuery.findByGroupId).not.toHaveBeenCalled();
      expect(invitationListQuery.findByGroupId).not.toHaveBeenCalled();
      expect(auditLogListQuery.findByGroupId).not.toHaveBeenCalled();
    },
  );

  describe("操作履歴（auditLogs）の取得と開示制御（COND-012）", () => {
    const dummyStaffActionLog: GroupAuditLogItem = {
      id: "log_staff_op",
      occurredAt: new Date("2026-09-20T10:00:00.000Z"),
      actorName: "事務局スタッフ太郎",
      actedAsStaff: true,
      action: AuditLogAction.MembershipChangeRole,
      targetType: AuditLogTargetType.Membership,
      targetId: "mem_2",
      changes: {
        role: { before: "member", after: "admin" },
      },
    };

    const dummyMemberActionLog: GroupAuditLogItem = {
      id: "log_member_op",
      occurredAt: new Date("2026-09-19T10:00:00.000Z"),
      actorName: "管理者 太郎",
      actedAsStaff: false,
      action: AuditLogAction.GroupUpdate,
      targetType: AuditLogTargetType.Group,
      targetId: testGroup.id,
      changes: {
        name: { before: "旧団体名", after: testGroup.name },
      },
    };

    const fakeAuditLogs: GroupAuditLogList = {
      items: [dummyStaffActionLog, dummyMemberActionLog],
      hasNextPage: false,
      userNames: { usr_member: "メンバー 次郎" },
    };

    it("自団体の管理者が開くと、事務局権限の記録は actor が { kind: 'staff' } となり、JSON.stringify(結果) に事務局員の氏名が含まれない", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([adminMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery(fakeAuditLogs);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: adminMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.canManage).toBe(true);
      if (view.canManage) {
        expect(view.auditLogs.items).toHaveLength(2);
        // 事務局権限の操作は { kind: "staff" }
        expect(view.auditLogs.items[0].actor).toEqual({ kind: "staff" });
        // 一般操作は { kind: "person", name: "管理者 太郎", actedAsStaff: false }
        expect(view.auditLogs.items[1].actor).toEqual({
          kind: "person",
          name: "管理者 太郎",
          actedAsStaff: false,
        });

        // 通信に載る中身（JSON.stringify(結果)）に事務局員の氏名が含まれない。ID は Query がそもそも返さない
        const serialized = JSON.stringify(view);
        expect(serialized).not.toContain("事務局スタッフ太郎");
      }
    });

    it("事務局が開くと、事務局権限の記録も個人名（kind: 'person', actedAsStaff: true）で受け取れる", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery(fakeAuditLogs);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: "usr_staff",
          isStaff: true,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.canManage).toBe(true);
      if (view.canManage) {
        expect(view.auditLogs.items[0].actor).toEqual({
          kind: "person",
          name: "事務局スタッフ太郎",
          actedAsStaff: true,
        });
      }
    });

    it("履歴 Query が失敗した場合は DatabaseError を返す", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([adminMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const failingAuditLogQuery = fakeGroupAuditLogListQuery({
        findByGroupId: () =>
          errAsync({
            code: QueryErrorCode.DatabaseError,
            message: "操作履歴の取得に失敗しました。",
          }),
      });

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: failingAuditLogQuery,
        },
        {
          groupId: testGroup.id,
          actorUserId: adminMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    });

    it("auditLogPage 引数がそのまま Query に渡される", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([adminMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery(fakeAuditLogs);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: createFakeGroupCalendarFeedRepository().repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: adminMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 3,
        },
      );

      expect(result.isOk()).toBe(true);
      expect(auditLogListQuery.findByGroupId.mock.calls[0]?.[1]).toBe(3);
      expect(auditLogListQuery.findByGroupId.mock.calls[0]?.[0]).toBe(testGroup.id);
      const view = result._unsafeUnwrap();
      if (view.canManage) {
        expect(view.auditLogs.page).toBe(3);
      }
    });

    it("見る人が所属していて購読行が存在すれば calendarFeed と isMember: true を返す", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([memberMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery();
      const feeds = createFakeGroupCalendarFeedRepository([
        {
          id: "feed_1",
          membershipId: memberMembership.id,
          token: "my_secret_token",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: feeds.repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: memberMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.isMember).toBe(true);
      expect(view.calendarFeed).toEqual({ token: "my_secret_token" });
      expect(feeds.findByMembershipId).toHaveBeenCalledWith(memberMembership.id);
    });

    it("見る人が所属していて未発行の場合は calendarFeed: null と isMember: true を返す", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([memberMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery();
      const feeds = createFakeGroupCalendarFeedRepository([]);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: feeds.repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: memberMembership.userId,
          isStaff: false,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.isMember).toBe(true);
      expect(view.calendarFeed).toBeNull();
      expect(feeds.findByMembershipId).toHaveBeenCalledWith(memberMembership.id);
    });

    it("事務局でもその団体に所属していれば isMember: true と自分の calendarFeed を返す", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([memberMembership]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery();
      const feeds = createFakeGroupCalendarFeedRepository([
        {
          id: "feed_1",
          membershipId: memberMembership.id,
          token: "staff_member_token",
          createdAt: baseNow,
          updatedAt: baseNow,
        },
      ]);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: feeds.repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: memberMembership.userId,
          isStaff: true,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      const view = result._unsafeUnwrap();
      expect(view.canManage).toBe(true);
      expect(view.isMember).toBe(true);
      expect(view.calendarFeed).toEqual({ token: "staff_member_token" });
    });

    it("所属していない事務局の場合は購読行を読みに行かず calendarFeed: null と isMember: false を返す", async () => {
      const groups = createFakeGroupRepository([testGroup]);
      const memberships = createFakeMembershipRepository([]);
      const memberListQuery = createFakeGroupMemberListQuery(testMembers);
      const invitationListQuery = createFakeGroupInvitationListQuery(testInvitations);
      const auditLogListQuery = createFakeGroupAuditLogListQuery();
      const feeds = createFakeGroupCalendarFeedRepository([]);

      const result = await getGroupManagementUseCase(
        {
          groupRepository: groups.repository,
          membershipRepository: memberships.repository,
          groupCalendarFeedRepository: feeds.repository,
          groupMemberListQuery: memberListQuery.query,
          groupInvitationListQuery: invitationListQuery.query,
          groupAuditLogListQuery: auditLogListQuery.query,
        },
        {
          groupId: testGroup.id,
          actorUserId: "usr_staff_outsider",
          isStaff: true,
          now: baseNow,
          auditLogPage: 1,
        },
      );

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.isMember).toBe(false);
      expect(view.calendarFeed).toBeNull();
      expect(feeds.findByMembershipId).not.toHaveBeenCalled();
    });
  });
});
