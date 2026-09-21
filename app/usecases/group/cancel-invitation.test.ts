import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import type {
  Membership,
  MembershipError,
  MembershipRepository,
  UpdateMembershipRoleInput,
} from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { cancelInvitationUseCase, type CancelInvitationArgs } from "./cancel-invitation";

const testGroupId = "grp_robotics";
const testInvitationId = "inv_123456";

const adminMembership: Membership = {
  groupId: testGroupId,
  userId: "usr_admin",
  roles: [MembershipRole.Admin],
};

const regularMember: Membership = {
  groupId: testGroupId,
  userId: "usr_member",
  roles: [MembershipRole.Member],
};

interface FakeMembershipRepoOptions {
  readonly findByGroupAndUserResult?: (
    groupId: string,
    userId: string,
  ) => ResultAsync<Membership | null, MembershipError>;
}

const createFakeMembershipRepository = (
  initialMemberships: readonly Membership[],
  options: FakeMembershipRepoOptions = {},
) => {
  let findByGroupAndUserCallCount = 0;
  const memberships = [...initialMemberships];

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      findByGroupAndUserCallCount += 1;
      if (options.findByGroupAndUserResult) {
        return options.findByGroupAndUserResult(groupId, userId);
      }
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
      return okAsync(found ?? null);
    },
    countAdmins: () =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "countAdmins is not used in this test",
      }),
    updateRole: (_input: UpdateMembershipRoleInput) =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "updateRole is not used in this test",
      }),
    remove: () =>
      errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "remove is not used in this test",
      }),
  };

  return {
    repository,
    findByGroupAndUserCallCount: () => findByGroupAndUserCallCount,
  };
};

interface FakeInvitationRepoOptions {
  readonly cancelResult?: (
    groupId: string,
    invitationId: string,
  ) => ResultAsync<number, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  let cancelCallCount = 0;
  let lastCancelGroupId: string | null = null;
  let lastCancelInvitationId: string | null = null;

  const repository: InvitationRepository = {
    findPendingByGroupAndEmail: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "findPendingByGroupAndEmail is not used in this test",
      }),
    create: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "create is not used in this test",
      }),
    cancel: (groupId, invitationId) => {
      cancelCallCount += 1;
      lastCancelGroupId = groupId;
      lastCancelInvitationId = invitationId;
      if (options.cancelResult) {
        return options.cancelResult(groupId, invitationId);
      }
      return okAsync(1);
    },
  };

  return {
    repository,
    cancelCallCount: () => cancelCallCount,
    lastCancelGroupId: () => lastCancelGroupId,
    lastCancelInvitationId: () => lastCancelInvitationId,
  };
};

describe("cancelInvitationUseCase", () => {
  const validArgs: CancelInvitationArgs = {
    groupId: testGroupId,
    actorUserId: "usr_admin",
    isStaff: false,
    invitationId: testInvitationId,
  };

  // 1. 管理者が取り消すと成功し、cancel に (groupId, invitationId) が渡る
  it("管理者が取り消すと成功し、cancel に (groupId, invitationId) が渡る", async () => {
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository();

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeInvitation.cancelCallCount()).toBe(1);
    expect(fakeInvitation.lastCancelGroupId()).toBe(testGroupId);
    expect(fakeInvitation.lastCancelInvitationId()).toBe(testInvitationId);
  });

  // 2. 事務局スタッフは所属していなくても成功し、findByGroupAndUser が呼ばれない
  it("事務局スタッフは所属していなくても成功し、findByGroupAndUser が呼ばれない", async () => {
    const fakeMembership = createFakeMembershipRepository([]);
    const fakeInvitation = createFakeInvitationRepository();

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      {
        ...validArgs,
        actorUserId: "usr_staff",
        isStaff: true,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
    expect(fakeInvitation.cancelCallCount()).toBe(1);
  });

  // 3. 一般メンバーは GroupForbidden
  it("一般メンバーは GroupForbidden になる", async () => {
    const fakeMembership = createFakeMembershipRepository([regularMember]);
    const fakeInvitation = createFakeInvitationRepository();

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      {
        ...validArgs,
        actorUserId: "usr_member",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupForbidden);
      expect(result.error.message).toBe("メンバーを招待できるのは管理者と事務局だけです。");
    }
    expect(fakeInvitation.cancelCallCount()).toBe(0);
  });

  // 4. 所属していない人は GroupNotFound（メッセージまで同一）
  it("所属していない人は GroupNotFound になる（メッセージまで同一）", async () => {
    const fakeMembership = createFakeMembershipRepository([]);
    const fakeInvitation = createFakeInvitationRepository();

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      {
        ...validArgs,
        actorUserId: "usr_stranger",
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.GroupNotFound);
      expect(result.error.message).toBe("グループが見つかりません。");
    }
    expect(fakeInvitation.cancelCallCount()).toBe(0);
  });

  // 5. groupId が空なら GroupNotFound でリポジトリが呼ばれない
  it.each(["", "   "])(
    "groupId が %j のときは GroupNotFound でリポジトリが呼ばれない",
    async (emptyGroupId) => {
      const fakeMembership = createFakeMembershipRepository([adminMembership]);
      const fakeInvitation = createFakeInvitationRepository();

      const result = await cancelInvitationUseCase(
        {
          membershipRepository: fakeMembership.repository,
          invitationRepository: fakeInvitation.repository,
        },
        {
          ...validArgs,
          groupId: emptyGroupId,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.GroupNotFound);
        expect(result.error.message).toBe("グループが見つかりません。");
      }
      expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
      expect(fakeInvitation.cancelCallCount()).toBe(0);
    },
  );

  // 6. invitationId が空・空白のみなら GroupInvalidInput で cancel が呼ばれない
  it.each(["", "   "])(
    "invitationId が %j のときは GroupInvalidInput で cancel が呼ばれない",
    async (emptyInvitationId) => {
      const fakeMembership = createFakeMembershipRepository([adminMembership]);
      const fakeInvitation = createFakeInvitationRepository();

      const result = await cancelInvitationUseCase(
        {
          membershipRepository: fakeMembership.repository,
          invitationRepository: fakeInvitation.repository,
        },
        {
          ...validArgs,
          invitationId: emptyInvitationId,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.GroupInvalidInput);
        expect(result.error.message).toBe("取り消す招待が指定されていません。");
      }
      expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
      expect(fakeInvitation.cancelCallCount()).toBe(0);
    },
  );

  // 7. cancel が 0 件を返したら InvitationNotFound
  it("cancel が 0 件を返したら InvitationNotFound になる", async () => {
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({
      cancelResult: () => okAsync(0),
    });

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.message).toBe(
        "対象の招待が見つかりません。すでに取り消されたか、承諾された可能性があります。",
      );
    }
  });

  // 8. cancel が DB エラーを返したら DatabaseError
  it("cancel が DB エラーを返したら DatabaseError になる", async () => {
    const fakeMembership = createFakeMembershipRepository([adminMembership]);
    const fakeInvitation = createFakeInvitationRepository({
      cancelResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "DB error",
        }),
    });

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: fakeMembership.repository,
        invitationRepository: fakeInvitation.repository,
      },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
    }
  });
});
