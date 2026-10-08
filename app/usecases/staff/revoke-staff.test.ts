import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { StaffErrorCode, type StaffMemberRepository } from "~/domain/staff";
import { revokeStaffUseCase, type RevokeStaffArgs } from "./revoke-staff";

describe("revokeStaffUseCase", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const baseArgs: RevokeStaffArgs = {
    actorUserId: "usr_actor",
    isStaff: true,
    targetUserId: "usr_target",
    now,
  };

  const setupDeps = (
    options: {
      targetStaff?: { id: string } | null;
      staffCount?: number;
      revokedCount?: number;
    } = {},
  ) => {
    let passedTargetId = "";
    let passedAuditLog: unknown = null;
    const staffMemberRepository: StaffMemberRepository = {
      findStaffByEmail: () => okAsync(null),
      findStaffById: (id) => {
        if (options.targetStaff !== undefined) {
          return okAsync(options.targetStaff);
        }
        return okAsync({ id });
      },
      countStaff: () => okAsync(options.staffCount ?? 2),
      revoke: (id, _now, auditLog) => {
        passedTargetId = id;
        passedAuditLog = auditLog;
        return okAsync(options.revokedCount ?? 1);
      },
    };

    return {
      deps: { staffMemberRepository },
      getPassedTargetId: () => passedTargetId,
      getPassedAuditLog: () => passedAuditLog,
    };
  };

  it("事務局でない人は拒否される", async () => {
    const { deps } = setupDeps();
    const result = await revokeStaffUseCase(deps, { ...baseArgs, isStaff: false });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.Forbidden);
    }
  });

  it("対象 ID が空の場合は InvalidInput を返す", async () => {
    const { deps } = setupDeps();
    const result = await revokeStaffUseCase(deps, { ...baseArgs, targetUserId: "  " });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
    }
  });

  it("対象が事務局でない場合は MemberNotFound を返す", async () => {
    const { deps } = setupDeps({ targetStaff: null });
    const result = await revokeStaffUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.MemberNotFound);
    }
  });

  it("最後の 1 人の場合は LastStaffRequired を返す", async () => {
    const { deps } = setupDeps({ staffCount: 1 });
    const result = await revokeStaffUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.LastStaffRequired);
      expect(result.error.userMessage).toContain("事務局が 0 人になるため");
    }
  });

  it("条件付き UPDATE が 0 件の場合は Conflict を返す", async () => {
    const { deps } = setupDeps({ revokedCount: 0 });
    const result = await revokeStaffUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.Conflict);
      expect(result.error.userMessage).toContain("ほかの事務局の操作と重なったため");
    }
  });

  it("自分自身の剥奪は他に事務局がいれば成功し、revokedSelf が true になる", async () => {
    const { deps, getPassedTargetId } = setupDeps({ staffCount: 2, revokedCount: 1 });
    const result = await revokeStaffUseCase(deps, {
      ...baseArgs,
      targetUserId: baseArgs.actorUserId,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revokedSelf).toBe(true);
    }
    expect(getPassedTargetId()).toBe(baseArgs.actorUserId);
  });

  it("他人を剥奪した場合は revokedSelf が false になり、操作履歴が渡される", async () => {
    const { deps, getPassedTargetId, getPassedAuditLog } = setupDeps({
      staffCount: 3,
      revokedCount: 1,
    });
    const result = await revokeStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revokedSelf).toBe(false);
    }
    expect(getPassedTargetId()).toBe("usr_target");
    expect(getPassedAuditLog()).toEqual({
      occurredAt: now,
      actorId: baseArgs.actorUserId,
      actedAsStaff: true,
      action: "staff_role.revoke",
      targetId: "usr_target",
      groupId: null,
      changes: {
        is_staff: { before: true, after: false },
      },
    });
  });
});
