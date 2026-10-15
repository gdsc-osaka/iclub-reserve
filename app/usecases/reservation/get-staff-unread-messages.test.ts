import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { QueryErrorCode } from "~/query/error";
import type {
  StaffUnreadMessagesQuery,
  StaffUnreadMessagesResult,
} from "~/query/reservation/staff-unread-messages";
import { getStaffUnreadMessagesUseCase } from "./get-staff-unread-messages";

describe("getStaffUnreadMessagesUseCase", () => {
  it("非スタッフの場合は Forbidden エラーを返す", async () => {
    const mockQuery: StaffUnreadMessagesQuery = {
      findUnreadForStaff: () =>
        okAsync({ items: [], overflowCount: 0, allUnreadReservationIds: [] }),
    };

    const result = await getStaffUnreadMessagesUseCase(
      { staffUnreadMessagesQuery: mockQuery },
      { actorUserId: "user_1", isStaff: false, now: new Date() },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.code).toBe(QueryErrorCode.Forbidden);
  });

  it("スタッフの場合はクエリの結果を返す", async () => {
    const mockResult: StaffUnreadMessagesResult = {
      items: [
        {
          reservationId: "res_1",
          groupId: "grp_1",
          groupName: "テスト団体",
          facilityId: "fac_1",
          facilityName: "会議室",
          startAt: new Date("2026-10-25T10:00:00Z"),
          endAt: new Date("2026-10-25T12:00:00Z"),
          latestMessage: {
            body: "こんにちは",
            sentAt: new Date("2026-10-20T10:00:00Z"),
          },
          otherCount: 0,
        },
      ],
      overflowCount: 0,
      allUnreadReservationIds: ["res_1"],
    };

    const mockQuery: StaffUnreadMessagesQuery = {
      findUnreadForStaff: (staffUserId, _now) => {
        expect(staffUserId).toBe("staff_1");
        return okAsync(mockResult);
      },
    };

    const result = await getStaffUnreadMessagesUseCase(
      { staffUnreadMessagesQuery: mockQuery },
      { actorUserId: "staff_1", isStaff: true, now: new Date() },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual(mockResult);
  });
});
