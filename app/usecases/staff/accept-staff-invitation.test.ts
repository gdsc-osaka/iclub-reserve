import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import {
  StaffErrorCode,
  type AcceptStaffInvitationInput,
  type StaffError,
  type StaffInvitationRepository,
} from "~/domain/staff";
import {
  acceptStaffInvitationUseCase,
  type AcceptStaffInvitationArgs,
} from "./accept-staff-invitation";

const testInvitationId = "sinv_123456";
const testUserId = "usr_target";
const testEmail = "staff-invitee@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

interface FakeStaffInvitationRepoOptions {
  readonly acceptResult?: (input: AcceptStaffInvitationInput) => ResultAsync<boolean, StaffError>;
}

const createFakeStaffInvitationRepository = (options: FakeStaffInvitationRepoOptions = {}) => {
  let acceptCallCount = 0;
  let lastAcceptInput: AcceptStaffInvitationInput | null = null;
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
    accept: (input) => {
      acceptCallCount += 1;
      lastAcceptInput = input;
      if (options.acceptResult) {
        return options.acceptResult(input);
      }
      return okAsync(true);
    },
    reject: () =>
      errAsync({
        code: StaffErrorCode.DatabaseError,
        message: "reject is not used in this test",
      }),
  };

  return {
    repository,
    acceptCallCount: () => acceptCallCount,
    lastAcceptInput: () => lastAcceptInput,
    findByIdCallCount: () => findByIdCallCount,
  };
};

describe("acceptStaffInvitationUseCase", () => {
  const validArgs: AcceptStaffInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: testUserId,
    actorEmail: testEmail,
    now: baseNow,
  };

  it("成功時に ok(null) が返る", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(fakeRepo.acceptCallCount()).toBe(1);
  });

  it("accept に正しい引数が渡り、メールアドレスは正規化される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, actorEmail: "Staff-Invitee@ECS.osaka-u.ac.jp" },
    );

    const input = fakeRepo.lastAcceptInput();
    expect(input).not.toBeNull();
    expect(input).toEqual({
      invitationId: testInvitationId,
      email: testEmail,
      userId: testUserId,
      now: baseNow,
    });
  });

  it("空文字の招待 ID では DB を引かずに NotFound を返す（存在秘匿）", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, invitationId: "   " },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
    expect(fakeRepo.acceptCallCount()).toBe(0);
  });

  it("前後に空白がある招待 ID は trim して渡される", async () => {
    const fakeRepo = createFakeStaffInvitationRepository();

    await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      { ...validArgs, invitationId: `  ${testInvitationId}  ` },
    );

    expect(fakeRepo.lastAcceptInput()?.invitationId).toBe(testInvitationId);
  });

  it("accept が false を返した場合は NotFound を返す", async () => {
    const fakeRepo = createFakeStaffInvitationRepository({
      acceptResult: () => okAsync(false),
    });

    const result = await acceptStaffInvitationUseCase(
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

    await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(fakeRepo.findByIdCallCount()).toBe(0);
  });

  it("リポジトリ層で DB エラーが発生した場合はそのまま返す", async () => {
    const dbError: StaffError = {
      code: StaffErrorCode.DatabaseError,
      message: "D1 batch failed",
    };
    const fakeRepo = createFakeStaffInvitationRepository({
      acceptResult: () => errAsync(dbError),
    });

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: fakeRepo.repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(dbError);
    }
  });
});
