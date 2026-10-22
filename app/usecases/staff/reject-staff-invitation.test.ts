import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { StaffErrorCode, type StaffError } from "~/domain/staff";
import { fakeStaffInvitationRepository } from "~/testing/fakes/staff";
import {
  rejectStaffInvitationUseCase,
  type RejectStaffInvitationArgs,
} from "./reject-staff-invitation";

const testInvitationId = "sinv_123456";
const testEmail = "staff-invitee@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

describe("rejectStaffInvitationUseCase", () => {
  const validArgs: RejectStaffInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: "usr_actor",
    actorEmail: testEmail,
    now: baseNow,
  };

  it("成功時に ok(null) が返り、操作履歴が渡される", async () => {
    const reject = vi.fn(() => okAsync(1));
    const repository = fakeStaffInvitationRepository({ reject });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(expect.anything(), {
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
    const reject = vi.fn(() => okAsync(1));
    const repository = fakeStaffInvitationRepository({ reject });

    await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, actorEmail: "Staff-Invitee@ECS.osaka-u.ac.jp" },
    );

    expect(reject).toHaveBeenCalledWith(
      {
        invitationId: testInvitationId,
        email: testEmail,
        now: baseNow,
      },
      expect.anything(),
    );
  });

  it("空文字の招待 ID では DB を引かずに NotFound を返す（存在秘匿）", async () => {
    const reject = vi.fn(() => okAsync(1));
    const repository = fakeStaffInvitationRepository({ reject });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, invitationId: "   " },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
    expect(reject).not.toHaveBeenCalled();
  });

  it("前後に空白がある招待 ID は trim して渡される", async () => {
    const reject = vi.fn(() => okAsync(1));
    const repository = fakeStaffInvitationRepository({ reject });

    await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, invitationId: `  ${testInvitationId}  ` },
    );

    expect(reject).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: testInvitationId }),
      expect.anything(),
    );
  });

  it("reject の件数が 0 件の場合は NotFound を返す", async () => {
    const reject = vi.fn(() => okAsync(0));
    const repository = fakeStaffInvitationRepository({ reject });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("事前 SELECT は行わず findById を呼ばない", async () => {
    const findById = vi.fn();
    const repository = fakeStaffInvitationRepository({
      reject: vi.fn(() => okAsync(1)),
      findById,
    });

    await rejectStaffInvitationUseCase({ staffInvitationRepository: repository }, validArgs);

    expect(findById).not.toHaveBeenCalled();
  });

  it("リポジトリ層で DB エラーが発生した場合はそのまま返す", async () => {
    const dbError: StaffError = {
      code: StaffErrorCode.DatabaseError,
      message: "D1 update failed",
    };
    const reject = vi.fn(() => errAsync(dbError));
    const repository = fakeStaffInvitationRepository({ reject });

    const result = await rejectStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(dbError);
    }
  });
});
