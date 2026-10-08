import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import {
  InvitationStatus,
  type AcceptInvitationInput,
  type Invitation,
  type InvitationRepository,
} from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { acceptInvitationUseCase, type AcceptInvitationArgs } from "./accept-invitation";

const testInvitationId = "inv_123456";
const testGroupId = "grp_robotics";
const testUserId = "usr_student";
const testEmail = "student@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

const defaultInvitation: Invitation = {
  id: testInvitationId,
  groupId: testGroupId,
  email: testEmail,
  role: MembershipRole.Member,
  inviterUserId: "usr_inviter",
  expiresAt: new Date("2026-04-08T10:00:00.000Z"),
  createdAt: baseNow,
  status: InvitationStatus.Pending,
};

interface FakeInvitationRepoOptions {
  readonly acceptResult?: (
    input: AcceptInvitationInput,
    auditLog: AuditLogDraft,
  ) => ResultAsync<string | null, GroupError>;
  readonly findByIdResult?: (invitationId: string) => ResultAsync<Invitation | null, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  let acceptCallCount = 0;
  let lastAcceptInput: AcceptInvitationInput | null = null;
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
    cancel: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "cancel is not used in this test",
      }),
    findById: (invitationId) => {
      findByIdCallCount += 1;
      if (options.findByIdResult) {
        return options.findByIdResult(invitationId);
      }
      return okAsync(defaultInvitation);
    },
    accept: (input, auditLog) => {
      acceptCallCount += 1;
      lastAcceptInput = input;
      lastAuditLog = auditLog;
      if (options.acceptResult) {
        return options.acceptResult(input, auditLog);
      }
      return okAsync(testGroupId);
    },
    reject: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "reject is not used in this test",
      }),
  };

  return {
    repository,
    acceptCallCount: () => acceptCallCount,
    lastAcceptInput: () => lastAcceptInput,
    lastAuditLog: () => lastAuditLog,
    findByIdCallCount: () => findByIdCallCount,
  };
};

describe("acceptInvitationUseCase", () => {
  const validArgs: AcceptInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: testUserId,
    actorEmail: testEmail,
    now: baseNow,
  };

  // 1. 成功 → groupId が返る
  it("成功時に groupId が返る", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    const result = await acceptInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ groupId: testGroupId });
    }
  });

  // 2. accept に渡る引数を確かめる
  it("accept に正しい引数が渡り、membershipId が空でない文字列である", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    await acceptInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      {
        ...validArgs,
        actorEmail: "  STUDENT@ECS.OSAKA-U.AC.JP  ",
      },
    );

    expect(fakeInvitation.acceptCallCount()).toBe(1);
    const input = fakeInvitation.lastAcceptInput();
    expect(input).not.toBeNull();
    expect(input?.invitationId).toBe(testInvitationId);
    expect(input?.email).toBe(testEmail); // 正規化されていること
    expect(input?.userId).toBe(testUserId);
    expect(input?.now).toBe(baseNow);
    expect(typeof input?.membershipId).toBe("string");
    expect(input?.membershipId.length).toBeGreaterThan(0);
  });

  // 3. accept が null → InvitationNotFound
  it("accept が null を返した場合は InvitationNotFound になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      acceptResult: () => okAsync(null),
    });

    const result = await acceptInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 4. invitationId が空文字・空白のみ → InvitationNotFound で、accept が呼ばれない
  it.each(["", "   "])(
    "invitationId が %j のときは InvitationNotFound になり、accept が呼ばれない",
    async (emptyId) => {
      const fakeInvitation = createFakeInvitationRepository();

      const result = await acceptInvitationUseCase(
        { invitationRepository: fakeInvitation.repository },
        { ...validArgs, invitationId: emptyId },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
        expect(result.error.userMessage).toBeUndefined();
      }
      expect(fakeInvitation.acceptCallCount()).toBe(0);
    },
  );

  // 5. accept が DB エラー → DatabaseError
  it("accept が DB エラーを返した場合は DatabaseError になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      acceptResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "DB connection failed",
        }),
    });

    const result = await acceptInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.DatabaseError);
      expect(result.error.message).toBe("DB connection failed");
    }
  });

  // 6. findById が 1 度呼ばれ、操作履歴が正しく渡る（COND-013）
  it("事前 SELECT で findById が呼ばれ、操作履歴が渡る", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    await acceptInvitationUseCase({ invitationRepository: fakeInvitation.repository }, validArgs);

    expect(fakeInvitation.findByIdCallCount()).toBe(1);
    const auditLog = fakeInvitation.lastAuditLog();
    expect(auditLog).not.toBeNull();
    expect(auditLog?.action).toBe(AuditLogAction.InvitationAccept);
    expect(auditLog?.actorId).toBe(testUserId);
    expect(auditLog?.targetId).toBe(testInvitationId);
    expect(auditLog?.groupId).toBe(testGroupId);
    expect(auditLog?.changes).toEqual({
      email: { before: testEmail, after: testEmail },
      role: { before: MembershipRole.Member, after: MembershipRole.Member },
      status: { before: InvitationStatus.Pending, after: InvitationStatus.Accepted },
    });
  });
});
