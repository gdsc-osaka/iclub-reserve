import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { QueryErrorCode } from "~/query/error";
import type {
  FacilityManagementItem,
  FacilityManagementListQuery,
} from "~/query/facility/facility-management-list";
import { listFacilitiesForManagementUseCase } from "./list-facilities-for-management";

describe("listFacilitiesForManagementUseCase", () => {
  const mockItems: readonly FacilityManagementItem[] = [
    {
      id: "fac_1",
      name: "3Dプリンター",
      description: "説明",
      photoUrl: null,
      isActive: true,
      hasGoogleCalendar: true,
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    },
  ];

  it("事務局スタッフ（isStaff: true）であれば一覧を取得できる", async () => {
    const listAllMock = vi.fn().mockReturnValue(okAsync(mockItems));
    const facilityManagementListQuery = {
      listAll: listAllMock,
    } as unknown as FacilityManagementListQuery;

    const result = await listFacilitiesForManagementUseCase(
      { facilityManagementListQuery },
      { actorUserId: "usr_staff_01", isStaff: true },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(mockItems);
    expect(listAllMock).toHaveBeenCalledOnce();
  });

  it("事務局スタッフでなければ（isStaff: false）Query を呼ばずに Forbidden を返す", async () => {
    const listAllMock = vi.fn();
    const facilityManagementListQuery = {
      listAll: listAllMock,
    } as unknown as FacilityManagementListQuery;

    const result = await listFacilitiesForManagementUseCase(
      { facilityManagementListQuery },
      { actorUserId: "usr_user_01", isStaff: false },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
    expect(listAllMock).not.toHaveBeenCalled();
  });
});
