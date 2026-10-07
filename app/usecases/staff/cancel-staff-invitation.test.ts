import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { StaffErrorCode, type StaffInvitationRepository } from "~/domain/staff";
import {
  cancelStaffInvitationUseCase,
  type CancelStaffInvitationArgs,
} from "./cancel-staff-invitation";

describe("cancelStaffInvitationUseCase", () => {
  const baseArgs: CancelStaffInvitationArgs = {
    actorUserId: "usr_staff_actor",
    isStaff: true,
    invitationId: "inv_to_cancel",
  };

  const setupDeps = (canceledCount: number) => {
    let passedId = "";
    const staffInvitationRepository: StaffInvitationRepository = {
      findPendingByEmail: () => okAsync(null),
      create: () => okAsync({ enqueuedMailIds: [] }),
      cancel: (id) => {
        passedId = id;
        return okAsync(canceledCount);
      },
      findById: () => okAsync(null),
      accept: () => okAsync(false),
      reject: () => okAsync(0),
    };

    return {
      deps: { staffInvitationRepository },
      getPassedId: () => passedId,
    };
  };

  it("事務局でない人は拒否される", async () => {
    const { deps } = setupDeps(1);
    const result = await cancelStaffInvitationUseCase(deps, { ...baseArgs, isStaff: false });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.Forbidden);
    }
  });

  it("招待 ID が空の場合は InvalidInput を返す", async () => {
    const { deps } = setupDeps(1);
    const result = await cancelStaffInvitationUseCase(deps, { ...baseArgs, invitationId: "   " });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
    }
  });

  it("cancel の結果が 0 件の場合は InvitationNotFound を返す", async () => {
    const { deps } = setupDeps(0);
    const result = await cancelStaffInvitationUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvitationNotFound);
    }
  });

  it("正常に取り消しが行われる", async () => {
    const { deps, getPassedId } = setupDeps(1);
    const result = await cancelStaffInvitationUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    expect(getPassedId()).toBe("inv_to_cancel");
  });
});
