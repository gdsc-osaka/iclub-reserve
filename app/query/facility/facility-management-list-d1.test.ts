/**
 * 施設の管理一覧（findFacilityManagementList）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - 並び順（有効な施設が先・施設名の昇順・同名は ID の昇順）
 * - hasGoogleCalendar（カレンダー ID が null・空白だけ・値あり の 3 通り）
 */
import { describe, expect, it } from "vitest";

import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findFacilityManagementList } from "./facility-management-list";

const testDb = useD1TestDb();

describe("findFacilityManagementList", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findFacilityManagementList(testDb.db, { isStaff: false });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("有効な施設を先に、施設名の昇順、同名は ID の昇順で並べる", async () => {
    await testDb.seed(
      seedFacility({
        id: "fac_inactive_a",
        name: "A 施設",
        isActive: false,
        updatedAt: new Date(1000),
      }),
      seedFacility({
        id: "fac_active_b",
        name: "B 施設",
        isActive: true,
        updatedAt: new Date(1000),
      }),
      seedFacility({
        id: "fac_active_a2",
        name: "A 施設",
        isActive: true,
        updatedAt: new Date(1000),
      }),
      seedFacility({
        id: "fac_active_a1",
        name: "A 施設",
        isActive: true,
        updatedAt: new Date(1000),
      }),
      seedFacility({
        id: "fac_inactive_b",
        name: "B 施設",
        isActive: false,
        updatedAt: new Date(1000),
      }),
    );

    const result = await findFacilityManagementList(testDb.db, { isStaff: true });

    expect(result._unsafeUnwrap().map((item) => item.id)).toEqual([
      "fac_active_a1",
      "fac_active_a2",
      "fac_active_b",
      "fac_inactive_a",
      "fac_inactive_b",
    ]);
  });

  it("hasGoogleCalendar は google_calendar_id が null・空白だけのときは false、値があるときは true になる", async () => {
    await testDb.seed(
      seedFacility({
        id: "fac_1_null",
        name: "施設1",
        description: "説明1",
        photoUrl: "https://example.com/1.jpg",
        googleCalendarId: null,
        isActive: true,
        updatedAt: new Date(1000),
      }),
      seedFacility({
        id: "fac_2_blank",
        name: "施設2",
        googleCalendarId: "   ",
        isActive: true,
        updatedAt: new Date(2000),
      }),
      seedFacility({
        id: "fac_3_set",
        name: "施設3",
        googleCalendarId: "cal_123@group.calendar.google.com",
        isActive: true,
        updatedAt: new Date(3000),
      }),
    );

    const result = await findFacilityManagementList(testDb.db, { isStaff: true });

    expect(
      result._unsafeUnwrap().map(({ id, hasGoogleCalendar }) => ({ id, hasGoogleCalendar })),
    ).toEqual([
      { id: "fac_1_null", hasGoogleCalendar: false },
      { id: "fac_2_blank", hasGoogleCalendar: false },
      { id: "fac_3_set", hasGoogleCalendar: true },
    ]);
  });
});
