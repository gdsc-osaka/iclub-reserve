import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import { getFacilityUseCase } from "./get-facility";

const mockFacility: Facility = {
  id: "fac_3d_printer",
  name: "吹田：3Dプリンター",
  description: "説明文",
  photoUrl: "/facility-photos/photo123.jpg",
  googleCalendarId: "cal@google.com",
  calendarUrl: "https://calendar.google.com/calendar/ical/cal%40google.com/public/basic.ics",
  isActive: true,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

describe("getFacilityUseCase", () => {
  it("事務局スタッフ（isStaff: true）であれば施設を取得できる", async () => {
    const findByIdMock = vi.fn().mockReturnValue(okAsync(mockFacility));
    const facilityRepository = {
      findById: findByIdMock,
    } as unknown as FacilityRepository;

    const result = await getFacilityUseCase(
      { facilityRepository },
      {
        facilityId: "fac_3d_printer",
        actorUserId: "usr_staff_01",
        isStaff: true,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(mockFacility);
    expect(findByIdMock).toHaveBeenCalledWith("fac_3d_printer");
  });

  it("事務局スタッフでなければ（isStaff: false）DB を引かずに Forbidden になる", async () => {
    const findByIdMock = vi.fn();
    const facilityRepository = {
      findById: findByIdMock,
    } as unknown as FacilityRepository;

    const result = await getFacilityUseCase(
      { facilityRepository },
      {
        facilityId: "fac_3d_printer",
        actorUserId: "usr_normal_01",
        isStaff: false,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Forbidden);
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("施設 ID が空文字または空白のみの場合は DB を引かずに NotFound になる", async () => {
    const findByIdMock = vi.fn();
    const facilityRepository = {
      findById: findByIdMock,
    } as unknown as FacilityRepository;

    const result = await getFacilityUseCase(
      { facilityRepository },
      {
        facilityId: "   ",
        actorUserId: "usr_staff_01",
        isStaff: true,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("存在しない施設 ID の場合はリポジトリの NotFound が返る", async () => {
    const facilityRepository = {
      findById: vi.fn().mockReturnValue(
        errAsync({
          code: FacilityErrorCode.NotFound,
          message: "施設が見つかりません。",
        }),
      ),
    } as unknown as FacilityRepository;

    const result = await getFacilityUseCase(
      { facilityRepository },
      {
        facilityId: "fac_not_exists",
        actorUserId: "usr_staff_01",
        isStaff: true,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
  });
});
