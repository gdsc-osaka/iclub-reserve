import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { GroupError } from "~/domain/group";
import { GroupErrorCode } from "~/domain/group";
import { InvitationStatus, type Invitation, type RejectInvitationInput } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { fakeInvitationRepository } from "~/testing/fakes/invitation";
import { rejectInvitationUseCase, type RejectInvitationArgs } from "./reject-invitation";

const testInvitationId = "inv_123456";
const testEmail = "student@ecs.osaka-u.ac.jp";
const testActorUserId = "user_actor_123";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

const defaultInvitation: Invitation = {
  id: testInvitationId,
  groupId: "grp_123456",
  email: testEmail,
  role: MembershipRole.Member,
  inviterUserId: "user_inviter_123",
  expiresAt: new Date("2026-04-08T10:00:00.000Z"),
  createdAt: baseNow,
  status: InvitationStatus.Pending,
};

interface FakeInvitationRepoOptions {
  readonly rejectResult?: (
    input: RejectInvitationInput,
    auditLog: AuditLogDraft,
  ) => ResultAsync<number, GroupError>;
  readonly findByIdResult?: (invitationId: string) => ResultAsync<Invitation | null, GroupError>;
}

const createFakeInvitationRepository = (options: FakeInvitationRepoOptions = {}) => {
  const findById = vi.fn((invitationId: string) => {
    if (options.findByIdResult) {
      return options.findByIdResult(invitationId);
    }
    return okAsync(defaultInvitation);
  });

  const reject = vi.fn((input: RejectInvitationInput, auditLog: AuditLogDraft) => {
    if (options.rejectResult) {
      return options.rejectResult(input, auditLog);
    }
    return okAsync(1);
  });

  const repository = fakeInvitationRepository({
    findById,
    reject,
  });

  return {
    repository,
    findById,
    reject,
  };
};

describe("rejectInvitationUseCase", () => {
  const validArgs: RejectInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: testActorUserId,
    actorEmail: testEmail,
    now: baseNow,
  };

  // 1. 成功 → null が返る
  it("成功時に null が返る", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    const result = await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  // 2. reject に渡る引数を確かめる
  it("reject に正しい引数が渡り、email が正規化されている", async () => {
    const fakeInvitation = createFakeInvitationRepository();

    await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      {
        ...validArgs,
        actorEmail: "  STUDENT@ECS.OSAKA-U.AC.JP  ",
      },
    );

    expect(fakeInvitation.reject).toHaveBeenCalledTimes(1);
    const input = fakeInvitation.reject.mock.calls[0]?.[0];
    expect(input).not.toBeNull();
    expect(input?.invitationId).toBe(testInvitationId);
    expect(input?.email).toBe(testEmail);
    expect(input?.now).toBe(baseNow);
  });

  // 3. reject が 0 件 → InvitationNotFound
  it("reject が 0 件を返した場合は InvitationNotFound になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      rejectResult: () => okAsync(0),
    });

    const result = await rejectInvitationUseCase(
      { invitationRepository: fakeInvitation.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
      expect(result.error.userMessage).toBeUndefined();
    }
  });

  // 4. invitationId が空文字・空白のみ → InvitationNotFound で、reject が呼ばれない
  it.each(["", "   "])(
    "invitationId が %j のときは InvitationNotFound になり、reject が呼ばれない",
    async (emptyId) => {
      const fakeInvitation = createFakeInvitationRepository();

      const result = await rejectInvitationUseCase(
        { invitationRepository: fakeInvitation.repository },
        { ...validArgs, invitationId: emptyId },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(GroupErrorCode.InvitationNotFound);
        expect(result.error.userMessage).toBeUndefined();
      }
      expect(fakeInvitation.reject).not.toHaveBeenCalled();
    },
  );

  // 5. reject が DB エラー → DatabaseError
  it("reject が DB エラーを返した場合は DatabaseError になる", async () => {
    const fakeInvitation = createFakeInvitationRepository({
      rejectResult: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "DB connection failed",
        }),
    });

    const result = await rejectInvitationUseCase(
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

    await rejectInvitationUseCase({ invitationRepository: fakeInvitation.repository }, validArgs);

    expect(fakeInvitation.findById).toHaveBeenCalledTimes(1);
    const auditLog = fakeInvitation.reject.mock.calls[0]?.[1];
    expect(auditLog).not.toBeNull();
    expect(auditLog?.action).toBe(AuditLogAction.InvitationDecline);
    expect(auditLog?.actorId).toBe(testActorUserId);
    expect(auditLog?.targetId).toBe(testInvitationId);
    expect(auditLog?.groupId).toBe("grp_123456");
    expect(auditLog?.changes).toEqual({
      email: { before: testEmail, after: testEmail },
      role: { before: MembershipRole.Member, after: MembershipRole.Member },
      status: { before: InvitationStatus.Pending, after: InvitationStatus.Rejected },
    });
  });
});
