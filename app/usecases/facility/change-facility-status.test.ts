import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import { changeFacilityStatusUseCase } from "./change-facility-status";

describe("changeFacilityStatusUseCase", () => {
  const now = new Date("2026-10-01T15:00:00Z");

  const activeFacility: Facility = {
    id: "fac_active",
    name: "アクティブ施設",
    description: null,
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
  };

  const inactiveFacility: Facility = {
    ...activeFacility,
    id: "fac_inactive",
    name: "非アクティブ施設",
    isActive: false,
  };

  it("事務局スタッフでなければ Forbidden になる", async () => {
    const facilityRepository = {} as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_active",
        actorUserId: "usr_user_01",
        isStaff: false,
        status: "inactive",
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Forbidden);
  });

  it.each(["", "   "])("施設 ID が空文字（%o）の場合は NotFound になる", async (id) => {
    const facilityRepository = {} as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: id,
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "inactive",
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
  });

  it.each(["pending", "enabled", "disabled", "invalid", ""])(
    "不正な変更先ステータス（%s）は InvalidInput になる",
    async (status) => {
      const facilityRepository = {} as unknown as FacilityRepository;

      const result = await changeFacilityStatusUseCase(
        { facilityRepository },
        {
          facilityId: "fac_active",
          actorUserId: "usr_staff_01",
          isStaff: true,
          status,
          now,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidInput);
    },
  );

  it("存在しない施設 ID の場合は NotFound になる", async () => {
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(
        errAsync({
          code: FacilityErrorCode.NotFound,
          message: "not found",
        }),
      ),
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_not_exists",
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "inactive",
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
  });

  it.each([
    { facility: activeFacility, targetStatus: "active" },
    { facility: inactiveFacility, targetStatus: "inactive" },
  ])("同じ状態への変更は InvalidTransition になる", async ({ facility, targetStatus }) => {
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(facility)),
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: facility.id,
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: targetStatus,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidTransition);
  });

  it("無効化時、今後の予約が残っている場合は HasUpcomingReservations となり件数が文言に入る", async () => {
    const countMock = vi.fn().mockReturnValue(okAsync(3));
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(activeFacility)),
      countBlockingReservations: countMock,
      updateActiveStatus: vi.fn(),
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_active",
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "inactive",
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.HasUpcomingReservations);
    expect(error.userMessage).toContain("3 件");
    expect(countMock).toHaveBeenCalledWith("fac_active", now);
  });

  it("無効化時、予約が 0 件なら updateActiveStatus が呼ばれて無効化できる", async () => {
    const updatedFacility = { ...activeFacility, isActive: false, updatedAt: now };
    const countMock = vi.fn().mockReturnValue(okAsync(0));
    const updateActiveStatusMock = vi.fn().mockReturnValue(okAsync(updatedFacility));

    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(activeFacility)),
      countBlockingReservations: countMock,
      updateActiveStatus: updateActiveStatusMock,
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_active",
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "inactive",
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isActive).toBe(false);
    expect(countMock).toHaveBeenCalledWith("fac_active", now);
    expect(updateActiveStatusMock).toHaveBeenCalledWith({
      id: "fac_active",
      from: true,
      to: false,
      updatedAt: now,
      now,
    });
  });

  it("再有効化（inactive -> active）時、予約件数を数えずに直接更新する", async () => {
    const updatedFacility = { ...inactiveFacility, isActive: true, updatedAt: now };
    const countMock = vi.fn();
    const updateActiveStatusMock = vi.fn().mockReturnValue(okAsync(updatedFacility));

    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(inactiveFacility)),
      countBlockingReservations: countMock,
      updateActiveStatus: updateActiveStatusMock,
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_inactive",
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "active",
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isActive).toBe(true);
    expect(countMock).not.toHaveBeenCalled();
    expect(updateActiveStatusMock).toHaveBeenCalledWith({
      id: "fac_inactive",
      from: false,
      to: true,
      updatedAt: now,
      now,
    });
  });

  it("更新件数が 0 行のとき（競合）、InvalidTransition を返す", async () => {
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(okAsync(inactiveFacility)),
      updateActiveStatus: vi.fn().mockReturnValue(
        errAsync({
          code: FacilityErrorCode.InvalidTransition,
          message: "0 rows updated",
        }),
      ),
    } as unknown as FacilityRepository;

    const result = await changeFacilityStatusUseCase(
      { facilityRepository },
      {
        facilityId: "fac_inactive",
        actorUserId: "usr_staff_01",
        isStaff: true,
        status: "active",
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidTransition);
  });
});
