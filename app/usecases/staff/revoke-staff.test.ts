import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { StaffErrorCode } from "~/domain/staff";
import { fakeStaffMemberRepository } from "~/testing/fakes/staff";
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
    const revoke = vi.fn((_id: string, _now: Date, _auditLog: unknown) =>
      okAsync(options.revokedCount ?? 1),
    );

    const staffMemberRepository = fakeStaffMemberRepository({
      findStaffById: (id) => {
        if (options.targetStaff !== undefined) {
          return okAsync(options.targetStaff);
        }
        return okAsync({ id });
      },
      countStaff: () => okAsync(options.staffCount ?? 2),
      revoke,
    });

    return {
      deps: { staffMemberRepository },
      revoke,
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

  it("自分自身の解除は他に事務局がいれば成功し、revokedSelf が true になる", async () => {
    const { deps, revoke } = setupDeps({ staffCount: 2, revokedCount: 1 });
    const result = await revokeStaffUseCase(deps, {
      ...baseArgs,
      targetUserId: baseArgs.actorUserId,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revokedSelf).toBe(true);
    }
    expect(revoke).toHaveBeenCalledWith(baseArgs.actorUserId, now, expect.anything());
  });

  it("他人を解除した場合は revokedSelf が false になり、操作履歴が渡される", async () => {
    const { deps, revoke } = setupDeps({
      staffCount: 3,
      revokedCount: 1,
    });
    const result = await revokeStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.revokedSelf).toBe(false);
    }
    expect(revoke).toHaveBeenCalledWith("usr_target", now, {
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
