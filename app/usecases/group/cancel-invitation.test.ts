import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import { InvitationStatus, type Invitation, type InvitationRepository } from "~/domain/invitation";
import type {
  StoredMembership,
  MembershipError,
  MembershipRepository,
  UpdateMembershipRoleInput,
} from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { cancelInvitationUseCase, type CancelInvitationArgs } from "./cancel-invitation";

const testGroupId = "grp_robotics";
const testInvitationId = "inv_123456";
const testEmail = "student@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

const defaultInvitation: Invitation = {
  id: testInvitationId,
  groupId: testGroupId,
  email: testEmail,
  role: MembershipRole.Member,
  inviterUserId: "usr_admin",
  expiresAt: new Date("2026-04-08T10:00:00.000Z"),
  createdAt: baseNow,
  status: InvitationStatus.Pending,
};

const adminMembership: StoredMembership = {
  id: "gm_adminMembership",
  groupId: testGroupId,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const regularMember: StoredMembership = {
  id: "gm_regularMember",
  groupId: testGroupId,
  userId: "usr_member",
  role: MembershipRole.Member,
};

interface FakeMembershipRepoOptions {
  readonly findByGroupAndUserResult?: (
    groupId: string,
    userId: string,
  ) => ResultAsync<StoredMembership | null, MembershipError>;
}

const createFakeMembershipRepository = (
  initialMemberships: readonly StoredMembership[],
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
    auditLog: AuditLogDraft,
  ) => ResultAsync<number, GroupError>;
  readonly findByIdResult?: (invitationId: string) => ResultAsync<Invitation | null, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  let cancelCallCount = 0;
  let lastCancelGroupId: string | null = null;
  let lastCancelInvitationId: string | null = null;
  let lastAuditLog: AuditLogDraft | null = null;
  let findByIdCallCount = 0;

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
    cancel: (groupId, invitationId, auditLog) => {
      cancelCallCount += 1;
      lastCancelGroupId = groupId;
      lastCancelInvitationId = invitationId;
      lastAuditLog = auditLog;
      if (options.cancelResult) {
        return options.cancelResult(groupId, invitationId, auditLog);
      }
      return okAsync(1);
    },
    findById: (invitationId) => {
      findByIdCallCount += 1;
      if (options.findByIdResult) {
        return options.findByIdResult(invitationId);
      }
      return okAsync(defaultInvitation);
    },
    accept: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "accept is not used in this test",
      }),
    reject: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "reject is not used in this test",
      }),
  };

  return {
    repository,
    cancelCallCount: () => cancelCallCount,
    lastCancelGroupId: () => lastCancelGroupId,
    lastCancelInvitationId: () => lastCancelInvitationId,
    lastAuditLog: () => lastAuditLog,
    findByIdCallCount: () => findByIdCallCount,
  };
};

describe("cancelInvitationUseCase", () => {
  const validArgs: CancelInvitationArgs = {
    groupId: testGroupId,
    actorUserId: "usr_admin",
    isStaff: false,
    invitationId: testInvitationId,
    now: baseNow,
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
    const auditLog = fakeInvitation.lastAuditLog();
    expect(auditLog?.actedAsStaff).toBe(false);
  });

  // 2. 事務局スタッフは所属していなくても成功し、actedAsStaff が true になる（COND-012）
  it("事務局スタッフは所属していなくても成功し、actedAsStaff が true になる", async () => {
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
    // COND-012: acted_as_staff 判定のため、事務局であっても操作者の所属を 1 回引く
    expect(fakeMembership.findByGroupAndUserCallCount()).toBe(1);
    expect(fakeInvitation.cancelCallCount()).toBe(1);
    const auditLog = fakeInvitation.lastAuditLog();
    expect(auditLog?.actedAsStaff).toBe(true);
  });

  // 3. 一般メンバーは Forbidden
  it("一般メンバーは Forbidden になる", async () => {
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
      expect(result.error.code).toBe(GroupErrorCode.Forbidden);
      expect(result.error.userMessage).toBe("メンバーを招待できるのは管理者と事務局だけです。");
    }
    expect(fakeInvitation.cancelCallCount()).toBe(0);
  });

  // 4. 所属していない人は NotVisible（利用者への応答を 404 に揃えるのは画面の側）
  it("所属していない人は NotVisible になり、画面に出す文言を持たない", async () => {
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
      expect(result.error.code).toBe(GroupErrorCode.NotVisible);
      expect(result.error.userMessage).toBeUndefined();
    }
    expect(fakeInvitation.cancelCallCount()).toBe(0);
  });

  // 5. groupId が空なら NotFound でリポジトリが呼ばれない
  it.each(["", "   "])(
    "groupId が %j のときは NotFound でリポジトリが呼ばれない",
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
        expect(result.error.code).toBe(GroupErrorCode.NotFound);
      }
      expect(fakeMembership.findByGroupAndUserCallCount()).toBe(0);
      expect(fakeInvitation.cancelCallCount()).toBe(0);
    },
  );

  // 6. invitationId が空・空白のみなら InvalidInput で cancel が呼ばれない
  it.each(["", "   "])(
    "invitationId が %j のときは InvalidInput で cancel が呼ばれない",
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
        expect(result.error.code).toBe(GroupErrorCode.InvalidInput);
        expect(result.error.userMessage).toBe("取り消す招待が指定されていません。");
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
