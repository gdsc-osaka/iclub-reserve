import { okAsync, errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { QueryErrorCode, type QueryError } from "~/query/error";
import {
  GroupUnreadEventType,
  type GroupUnreadUpdatesQuery,
  type GroupUnreadUpdatesResult,
} from "~/query/reservation/group-unread-updates";
import { getGroupUnreadUpdatesUseCase } from "./get-group-unread-updates";

describe("getGroupUnreadUpdatesUseCase", () => {
  it("クエリの結果をそのまま返す", async () => {
    const mockResult: GroupUnreadUpdatesResult = {
      items: [
        {
          reservationId: "res_1",
          groupId: "grp_1",
          groupName: "テスト団体",
          facilityId: "fac_1",
          facilityName: "会議室",
          startAt: new Date("2026-10-25T10:00:00Z"),
          endAt: new Date("2026-10-25T12:00:00Z"),
          latestEvent: {
            type: GroupUnreadEventType.Message,
            eventAt: new Date("2026-10-20T10:00:00Z"),
            messageBody: "連絡事項です",
            statusReason: null,
          },
          otherCount: 0,
        },
      ],
      overflowCount: 0,
      allUnreadReservationIds: ["res_1"],
    };

    const mockQuery: GroupUnreadUpdatesQuery = {
      findUnreadForUser: (userId, now) => {
        expect(userId).toBe("user_1");
        expect(now.toISOString()).toBe("2026-10-20T12:00:00.000Z");
        return okAsync(mockResult);
      },
    };

    const result = await getGroupUnreadUpdatesUseCase(
      { groupUnreadUpdatesQuery: mockQuery },
      { actorUserId: "user_1", now: new Date("2026-10-20T12:00:00.000Z") },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual(mockResult);
  });

  it("クエリエラーをそのまま返す", async () => {
    const mockError: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB error",
    };

    const mockQuery: GroupUnreadUpdatesQuery = {
      findUnreadForUser: () => errAsync(mockError),
    };

    const result = await getGroupUnreadUpdatesUseCase(
      { groupUnreadUpdatesQuery: mockQuery },
      { actorUserId: "user_1", now: new Date() },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual(mockError);
  });
});
