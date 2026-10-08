import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { RejectInvitationInput } from "~/domain/invitation";
import { StaffErrorCode, type StaffError, type StaffInvitationRepository } from "~/domain/staff";
import {
  rejectStaffInvitationUseCase,
  type RejectStaffInvitationArgs,
} from "./reject-staff-invitation";

const testInvitationId = "sinv_123456";
const testEmail = "staff-invitee@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

interface FakeStaffInvitationRepoOptions {
  readonly rejectResult?: (input: RejectInvitationInput) => ResultAsync<number, StaffError>;
}

const createFakeStaffInvitationRepository = (options: FakeStaffInvitationRepoOptions = {}) => {
  let rejectCallCount = 0;
  let lastRejectInput: RejectInvitationInput | null = null;
  let lastAuditLog: unknown = null;
  let findByIdCallCount = 0;

  const repository: StaffInvitationRepository = {
    findPendingByEmail: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "findPendingByEmail is not used in this test",
      }),
    create: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "create is not used in this test",
      }),
    cancel: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "cancel is not used in this test",
      }),
    findById: () => {
      findByIdCallCount += 1;
      return errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "findById should not be called",
      });
    },
    accept: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "accept is not used in this test",
      }),
    reject: (input, auditLog) => {
      rejectCallCount += 1;
      lastRejectInput = input;
      lastAuditLog = auditLog;
      if (options.rejectResult) {
        return options.rejectResult(input);
      }
      return okAsync(1);
    },
  };

  return {
    repository,
    rejectCallCount: () => rejectCallCount,
    lastRejectInput: () => lastRejectInput,
    lastAuditLog: () => lastAuditLog,
    findByIdCallCount: () => findByIdCallCount,
  };
};

describe("rejectStaffInvitationUseCase", () => {
  const validArgs: RejectStaffInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: "usr_actor",
    actorEmail: testEmail,
    now: baseNow,
  };

  it("成功時に ok(null) が返り、操作履歴が渡される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeRepo.rejectCallCount()).toBe(1);
    expect(fakeRepo.lastAuditLog()).toEqual({
      occurredAt: baseNow,
      actorId: "usr_actor",
      actedAsStaff: true,
      action: "staff_role.decline",
      targetId: testInvitationId,
      groupId: null,
      changes: {
        email: { before: testEmail, after: testEmail },
        status: { before: "pending", after: "rejected" },
      },
    });
  });

  it("reject に正しい引数が渡り、メールアドレスは正規化される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, actorEmail: "Staff-Invitee@ECS.osaka-u.ac.jp" },
    );

    const input = fakeRepo.lastRejectInput();
    expect(input).not.toBeNull();
    expect(input).toEqual({
      invitationId: testInvitationId,
      email: testEmail,
      now: baseNow,
    });
  });

  it("空文字の招待 ID では DB を引かずに NotFound を返す（存在秘匿）", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, invitationId: "   " },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
    expect(fakeRepo.rejectCallCount()).toBe(0);
  });

  it("前後に空白がある招待 ID は trim して渡される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, invitationId: `  ${testInvitationId}  ` },
    );

    expect(fakeRepo.lastRejectInput()?.invitationId).toBe(testInvitationId);
  });

  it("reject の件数が 0 件の場合は NotFound を返す", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      rejectResult: () => okAsync(0),
    });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("事前 SELECT は行わず findById を呼ばない", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(fakeRepo.findByIdCallCount()).toBe(0);
  });

  it("リポジトリ層で DB エラーが発生した場合はそのまま返す", async () => {
    const dbError: StaffError = {
      code: StaffErrorCode.DatabaseError,
      message: "D1 update failed",
    };
    const fakeRepo = createFakeStaffInvitationRepository({
      rejectResult: () => errAsync(dbError),
    });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(dbError);
    }
  });
});
