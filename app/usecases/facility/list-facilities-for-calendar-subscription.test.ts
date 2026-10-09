import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  FacilityCalendarSubscriptionItem,
  FacilityCalendarSubscriptionListQuery,
} from "~/query/facility/facility-calendar-subscription-list";
import { listFacilitiesForCalendarSubscriptionUseCase } from "./list-facilities-for-calendar-subscription";

describe("listFacilitiesForCalendarSubscriptionUseCase", () => {
  const mockItems: readonly FacilityCalendarSubscriptionItem[] = [
    {
      id: "fac_1",
      name: "吹田：3Dプリンター 積層タイプ",
      googleCalendarId: "test-calendar@group.calendar.google.com",
      calendarUrl:
        "https://calendar.google.com/calendar/ical/test-calendar%40group.calendar.google.com/public/basic.ics",
    },
    {
      id: "fac_2",
      name: "吹田：レーザーカッター",
      googleCalendarId: null,
      calendarUrl: null,
    },
  ];

  it("ログインユーザーであれば施設一覧を取得できる", async () => {
    const listActiveMock = vi.fn().mockReturnValue(okAsync(mockItems));
    const facilityCalendarSubscriptionListQuery = {
      listActive: listActiveMock,
    } as unknown as FacilityCalendarSubscriptionListQuery;

    const result = await listFacilitiesForCalendarSubscriptionUseCase(
      { facilityCalendarSubscriptionListQuery },
      { actorUserId: "usr_user_01" },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(mockItems);
    expect(listActiveMock).toHaveBeenCalledOnce();
  });

  it("Query が失敗した場合は QueryError を伝播する", async () => {
    const dbError: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB接続失敗",
    };
    const listActiveMock = vi.fn().mockReturnValue(errAsync(dbError));
    const facilityCalendarSubscriptionListQuery = {
      listActive: listActiveMock,
    } as unknown as FacilityCalendarSubscriptionListQuery;

    const result = await listFacilitiesForCalendarSubscriptionUseCase(
      { facilityCalendarSubscriptionListQuery },
      { actorUserId: "usr_user_01" },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(dbError);
    expect(listActiveMock).toHaveBeenCalledOnce();
  });
});
