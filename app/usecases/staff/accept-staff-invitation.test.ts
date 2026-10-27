import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { StaffErrorCode, type StaffError } from "~/domain/staff";
import { fakeStaffInvitationRepository } from "~/testing/fakes/staff";
import {
  acceptStaffInvitationUseCase,
  type AcceptStaffInvitationArgs,
} from "./accept-staff-invitation";

const testInvitationId = "sinv_123456";
const testUserId = "usr_target";
const testEmail = "staff-invitee@ecs.osaka-u.ac.jp";
const baseNow = new Date("2026-04-01T10:00:00.000Z");

describe("acceptStaffInvitationUseCase", () => {
  const validArgs: AcceptStaffInvitationArgs = {
    invitationId: testInvitationId,
    actorUserId: testUserId,
    actorEmail: testEmail,
    actorIsStaff: false,
    now: baseNow,
  };

  it("成功時に ok(null) が返り、操作履歴が渡される", async () => {
    const accept = vi.fn(() => okAsync(true));
    const repository = fakeStaffInvitationRepository({ accept });

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      validArgs,
    );

    expect(result.isOk()).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(expect.anything(), {
      occurredAt: baseNow,
      actorId: testUserId,
      actedAsStaff: true,
      action: "staff_role.accept",
      targetId: testUserId,
      groupId: null,
      changes: {
        is_staff: { before: false, after: true },
        staff_invitation_id: { before: testInvitationId, after: testInvitationId },
      },
    });
  });

  it("accept に正しい引数が渡り、メールアドレスは正規化される", async () => {
    const accept = vi.fn(() => okAsync(true));
    const repository = fakeStaffInvitationRepository({ accept });

    await acceptStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, actorEmail: "Staff-Invitee@ECS.osaka-u.ac.jp" },
    );

    expect(accept).toHaveBeenCalledWith(
      {
        invitationId: testInvitationId,
        email: testEmail,
        userId: testUserId,
        now: baseNow,
      },
      expect.anything(),
    );
  });

  it("空文字の招待 ID では DB を引かずに NotFound を返す（存在秘匿）", async () => {
    const accept = vi.fn(() => okAsync(true));
    const repository = fakeStaffInvitationRepository({ accept });

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, invitationId: "   " },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it("前後に空白がある招待 ID は trim して渡される", async () => {
    const accept = vi.fn(() => okAsync(true));
    const repository = fakeStaffInvitationRepository({ accept });

    await acceptStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      { ...validArgs, invitationId: `  ${testInvitationId}  ` },
    );

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: testInvitationId }),
      expect.anything(),
    );
  });

  it("accept が false を返した場合は NotFound を返す", async () => {
    const accept = vi.fn(() => okAsync(false));
    const repository = fakeStaffInvitationRepository({ accept });

    const result = await acceptStaffInvitationUseCase(
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
      accept: vi.fn(() => okAsync(true)),
      findById,
    });

    await acceptStaffInvitationUseCase({ staffInvitationRepository: repository }, validArgs);

    expect(findById).not.toHaveBeenCalled();
  });

  it("リポジトリ層で DB エラーが発生した場合はそのまま返す", async () => {
    const dbError: StaffError = {
      code: StaffErrorCode.DatabaseError,
      message: "D1 batch failed",
    };
    const accept = vi.fn(() => errAsync(dbError));
    const repository = fakeStaffInvitationRepository({ accept });

    const result = await acceptStaffInvitationUseCase(
      { staffInvitationRepository: repository },
      validArgs,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(dbError);
    }
  });
});
