import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { QueryErrorCode } from "~/query/error";
import type { StaffManagementQuery, StaffManagementView } from "~/query/staff/staff-management";
import { getStaffManagementUseCase } from "./get-staff-management";

describe("getStaffManagementUseCase", () => {
  const now = new Date("2026-10-09T12:00:00+09:00");

  const mockView: StaffManagementView = {
    members: [{ userId: "usr_1", name: "スタッフ", email: "staff@osaka-u.ac.jp" }],
    pendingInvitations: [],
  };

  const createMockQuery = (view: StaffManagementView = mockView): StaffManagementQuery => ({
    get: () => okAsync(view),
  });

  it("事務局スタッフはデータを取得できる", async () => {
    const deps = { staffManagementQuery: createMockQuery() };
    const result = await getStaffManagementUseCase(deps, {
      actorUserId: "usr_1",
      isStaff: true,
      now,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(mockView);
    }
  });

  it("期限を過ぎた招待は承諾待ちの一覧に出さない（STATE-003・SCR-007 と同じ扱い）", async () => {
    const deps = {
      staffManagementQuery: createMockQuery({
        ...mockView,
        pendingInvitations: [
          // 期限ちょうどは、もう承諾できないので出さない
          { id: "sinv_expired_now", email: "a@osaka-u.ac.jp", expiresAt: now },
          {
            id: "sinv_expired",
            email: "b@osaka-u.ac.jp",
            expiresAt: new Date("2026-10-09T11:59:59+09:00"),
          },
          {
            id: "sinv_valid",
            email: "c@osaka-u.ac.jp",
            expiresAt: new Date("2026-10-09T12:00:01+09:00"),
          },
        ],
      }),
    };

    const result = await getStaffManagementUseCase(deps, {
      actorUserId: "usr_1",
      isStaff: true,
      now,
    });

    expect(result._unsafeUnwrap().pendingInvitations.map((invitation) => invitation.id)).toEqual([
      "sinv_valid",
    ]);
  });

  it("事務局ではないユーザーは Forbidden で拒否される", async () => {
    const deps = { staffManagementQuery: createMockQuery() };
    const result = await getStaffManagementUseCase(deps, {
      actorUserId: "usr_1",
      isStaff: false,
      now,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(QueryErrorCode.Forbidden);
    }
  });
});
