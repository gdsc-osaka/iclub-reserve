import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type {
  StaffTodayScheduleQuery,
  StaffTodayScheduleResult,
} from "~/query/reservation/staff-today-schedule";
import { getStaffTodayScheduleUseCase } from "./get-staff-today-schedule";

describe("getStaffTodayScheduleUseCase", () => {
  it("非スタッフの場合は Forbidden エラーを返す", async () => {
    const mockQuery: StaffTodayScheduleQuery = {
      findTodaySchedule: () => okAsync({ facilities: [], reservations: [] }),
    };

    const result = await getStaffTodayScheduleUseCase(
      { staffTodayScheduleQuery: mockQuery },
      { isStaff: false, now: new Date() },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe(QueryErrorCode.Forbidden);
  });

  it("スタッフの場合はクエリの結果を返す", async () => {
    const mockResult: StaffTodayScheduleResult = {
      facilities: [
        {
          id: "fac_1",
          name: "会議室",
        },
      ],
      reservations: [
        {
          id: "res_1",
          groupId: "grp_1",
          groupName: "テスト団体",
          facilityId: "fac_1",
          facilityName: "会議室",
          startAt: new Date("2026-10-15T10:00:00Z"),
          endAt: new Date("2026-10-15T12:00:00Z"),
          status: ReservationStatus.Approved,
          headCount: 2,
        },
      ],
    };

    const mockQuery: StaffTodayScheduleQuery = {
      findTodaySchedule: () => okAsync(mockResult),
    };

    const result = await getStaffTodayScheduleUseCase(
      { staffTodayScheduleQuery: mockQuery },
      { isStaff: true, now: new Date() },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual(mockResult);
  });
});
