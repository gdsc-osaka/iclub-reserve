import { describe, expect, it } from "vite-plus/test";

import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findFacilityCalendarSubscriptionList } from "./facility-calendar-subscription-list";

const testDb = useD1TestDb();

describe("findFacilityCalendarSubscriptionList", () => {
  it("事務局でない人には Forbidden を返す（COND-009 / ADR-013 決定 7）", async () => {
    const result = await findFacilityCalendarSubscriptionList(testDb.db, { isStaff: false });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("有効な施設のみを施設名の昇順、同名は ID の昇順で返す（無効な施設は除外される）", async () => {
    await testDb.seed(
      seedFacility({
        id: "fac_active_b",
        name: "B 会議室",
        isActive: true,
        googleCalendarId: "cal_b@group.calendar.google.com",
        calendarUrl: "https://calendar.google.com/b.ics",
      }),
      seedFacility({
        id: "fac_inactive_a",
        name: "A 会議室",
        isActive: false,
        googleCalendarId: "cal_inactive@group.calendar.google.com",
        calendarUrl: "https://calendar.google.com/inactive.ics",
      }),
      seedFacility({
        id: "fac_active_a2",
        name: "A 会議室",
        isActive: true,
        googleCalendarId: "cal_a2@group.calendar.google.com",
        calendarUrl: "https://calendar.google.com/a2.ics",
      }),
      seedFacility({
        id: "fac_active_a1",
        name: "A 会議室",
        isActive: true,
        googleCalendarId: null,
        calendarUrl: null,
      }),
    );

    const result = await findFacilityCalendarSubscriptionList(testDb.db, { isStaff: true });

    expect(result.isOk()).toBe(true);
    const facilities = result._unsafeUnwrap();
    expect(facilities).toEqual([
      {
        id: "fac_active_a1",
        name: "A 会議室",
        googleCalendarId: null,
        calendarUrl: null,
      },
      {
        id: "fac_active_a2",
        name: "A 会議室",
        googleCalendarId: "cal_a2@group.calendar.google.com",
        calendarUrl: "https://calendar.google.com/a2.ics",
      },
      {
        id: "fac_active_b",
        name: "B 会議室",
        googleCalendarId: "cal_b@group.calendar.google.com",
        calendarUrl: "https://calendar.google.com/b.ics",
      },
    ]);
  });
});
