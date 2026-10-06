import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { QueryErrorCode } from "~/query/error";
import type { StaffManagementQuery, StaffManagementView } from "~/query/staff/staff-management";
import { getStaffManagementUseCase } from "./get-staff-management";

describe("getStaffManagementUseCase", () => {
  const mockView: StaffManagementView = {
    members: [{ userId: "usr_1", name: "スタッフ", email: "staff@osaka-u.ac.jp" }],
    pendingInvitations: [],
  };

  const createMockQuery = (): StaffManagementQuery => ({
    get: () => okAsync(mockView),
  });

  it("事務局スタッフはデータを取得できる", async () => {
    const deps = { staffManagementQuery: createMockQuery() };
    const result = await getStaffManagementUseCase(deps, {
      actorUserId: "usr_1",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(mockView);
    }
  });

  it("事務局ではないユーザーは Forbidden で拒否される", async () => {
    const deps = { staffManagementQuery: createMockQuery() };
    const result = await getStaffManagementUseCase(deps, {
      actorUserId: "usr_1",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(QueryErrorCode.Forbidden);
    }
  });
});
