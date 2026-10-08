import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { InvitationStatus } from "~/domain/invitation";
import {
  StaffErrorCode,
  type StaffInvitation,
  type StaffInvitationRepository,
} from "~/domain/staff";
import {
  cancelStaffInvitationUseCase,
  type CancelStaffInvitationArgs,
} from "./cancel-staff-invitation";

describe("cancelStaffInvitationUseCase", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const baseArgs: CancelStaffInvitationArgs = {
    actorUserId: "usr_staff_actor",
    isStaff: true,
    invitationId: "inv_to_cancel",
    now,
  };

  const defaultInvitation: StaffInvitation = {
    id: "inv_to_cancel",
    email: "target@osaka-u.ac.jp",
    status: InvitationStatus.Pending,
    expiresAt: new Date(now.getTime() + 10000),
    inviterId: "usr_prev_staff",
    createdAt: new Date(now.getTime() - 10000),
  };

  const setupDeps = (
    options: {
      invitation?: StaffInvitation | null;
      canceledCount?: number;
    } = {},
  ) => {
    let passedId = "";
    let passedAuditLog: unknown = null;
    const staffInvitationRepository: StaffInvitationRepository = {
      findPendingByEmail: () => okAsync(null),
      create: () => okAsync({ enqueuedMailIds: [] }),
      cancel: (id, auditLog) => {
        passedId = id;
        passedAuditLog = auditLog;
        return okAsync(options.canceledCount ?? 1);
      },
      findById: (id) =>
        okAsync(
          options.invitation !== undefined ? options.invitation : { ...defaultInvitation, id },
        ),
      accept: () => okAsync(false),
      reject: () => okAsync(0),
    };

    return {
      deps: { staffInvitationRepository },
      getPassedId: () => passedId,
      getPassedAuditLog: () => passedAuditLog,
    };
  };

  it("事務局でない人は拒否される", async () => {
    const { deps } = setupDeps();
    const result = await cancelStaffInvitationUseCase(deps, { ...baseArgs, isStaff: false });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.Forbidden);
    }
  });

  it("招待 ID が空の場合は InvalidInput を返す", async () => {
    const { deps } = setupDeps();
    const result = await cancelStaffInvitationUseCase(deps, { ...baseArgs, invitationId: "   " });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
    }
  });

  it("招待が存在しない場合は InvitationNotFound を返す", async () => {
    const { deps } = setupDeps({ invitation: null });
    const result = await cancelStaffInvitationUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("cancel の結果が 0 件の場合は InvitationNotFound を返す", async () => {
    const { deps } = setupDeps({ canceledCount: 0 });
    const result = await cancelStaffInvitationUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("正常に取り消しが行われ、操作履歴が渡される", async () => {
    const { deps, getPassedId, getPassedAuditLog } = setupDeps({ canceledCount: 1 });
    const result = await cancelStaffInvitationUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    expect(getPassedId()).toBe("inv_to_cancel");
    expect(getPassedAuditLog()).toEqual({
      occurredAt: now,
      actorId: baseArgs.actorUserId,
      actedAsStaff: true,
      action: "staff_role.cancel_invitation",
      targetId: "inv_to_cancel",
      groupId: null,
      changes: {
        email: { before: "target@osaka-u.ac.jp", after: "target@osaka-u.ac.jp" },
        status: { before: "pending", after: "canceled" },
      },
    });
  });
});
