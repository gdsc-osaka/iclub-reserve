/**
 * 空き状況カレンダーの読み取り（`findByFacilityAndPeriods`）のうち、どの施設を出すかの決め方を、
 * ローカルの本物の D1 に対して確かめるテスト。
 *
 * - 施設を指定しないとき、有効な施設が 2 件以上なら選ばずに返し、予約も読まない（ADR-014 決定 20）
 * - 有効な施設が 1 件だけなら、その施設を選んで予約を読む
 * - 有効な施設が 1 件も無い・指定した施設が無いときは NOT_FOUND
 *
 * 予約を見せる範囲（COND-008）はユースケースのテスト（get-availability-calendar.test.ts）で確かめる。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "~/infra/d1-test-seeds";
import type { AvailabilityPeriods } from "~/query/facility/facility-availability-calendar";
import { QueryErrorCode } from "~/query/error";
import { createFacilityAvailabilityCalendarQuery } from "./facility-availability-calendar-query";

const testDb = useD1TestDb();

const periods: AvailabilityPeriods = [
  { from: new Date("2026-11-01T00:00:00+09:00"), to: new Date("2026-11-29T00:00:00+09:00") },
];

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_applicant", name: "申請者", email: "applicant@example.com" }),
    seedGroup({ id: "grp_test", name: "テスト団体" }),
  );
});

/** 施設 `facilityId` に、期間の中の予約を 1 件入れる */
const seedReservationOf = (facilityId: string) =>
  seedReservation({
    id: `rsv_${facilityId}`,
    groupId: "grp_test",
    facilityId,
    startAt: new Date("2026-11-04T10:00:00+09:00"),
    endAt: new Date("2026-11-04T12:00:00+09:00"),
    status: ReservationStatus.Approved,
    createdBy: "usr_applicant",
  });

describe("createFacilityAvailabilityCalendarQuery.findByFacilityAndPeriods", () => {
  it("施設を指定せず、有効な施設が 2 件以上あれば、施設を選ばずに一覧だけを返し、予約は返さない", async () => {
    await testDb.seed(
      seedFacility({ id: "fac_a", name: "A 会議室" }),
      seedFacility({ id: "fac_b", name: "B 会議室" }),
      seedReservationOf("fac_a"),
    );

    const result = await createFacilityAvailabilityCalendarQuery(
      testDb.db,
    ).findByFacilityAndPeriods({ facilityId: null, periods });

    const calendar = result._unsafeUnwrap();
    expect(calendar.facilities.map((facility) => facility.id)).toEqual(["fac_a", "fac_b"]);
    expect(calendar.facility).toBeNull();
    expect(calendar.reservations).toEqual([]);
  });

  it("施設を指定せず、有効な施設が 1 件だけなら、その施設を選んで予約を返す（無効な施設は数えない）", async () => {
    await testDb.seed(
      seedFacility({ id: "fac_a", name: "A 会議室" }),
      seedFacility({ id: "fac_closed", name: "B 会議室", isActive: false }),
      seedReservationOf("fac_a"),
    );

    const result = await createFacilityAvailabilityCalendarQuery(
      testDb.db,
    ).findByFacilityAndPeriods({ facilityId: null, periods });

    const calendar = result._unsafeUnwrap();
    expect(calendar.facility?.id).toBe("fac_a");
    expect(calendar.reservations.map((reservation) => reservation.id)).toEqual(["rsv_fac_a"]);
  });

  it("施設を指定したら、その施設の予約だけを返す", async () => {
    await testDb.seed(
      seedFacility({ id: "fac_a", name: "A 会議室" }),
      seedFacility({ id: "fac_b", name: "B 会議室" }),
      seedReservationOf("fac_a"),
      seedReservationOf("fac_b"),
    );

    const result = await createFacilityAvailabilityCalendarQuery(
      testDb.db,
    ).findByFacilityAndPeriods({ facilityId: "fac_b", periods });

    const calendar = result._unsafeUnwrap();
    expect(calendar.facility?.id).toBe("fac_b");
    expect(calendar.reservations.map((reservation) => reservation.id)).toEqual(["rsv_fac_b"]);
  });

  it("有効な施設が 1 件も無ければ、施設を指定していなくても NOT_FOUND", async () => {
    await testDb.seed(seedFacility({ id: "fac_closed", name: "A 会議室", isActive: false }));

    const result = await createFacilityAvailabilityCalendarQuery(
      testDb.db,
    ).findByFacilityAndPeriods({ facilityId: null, periods });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });

  it("指定した施設が有効な施設の中に無ければ、選ぶ前の状態に戻さず NOT_FOUND", async () => {
    await testDb.seed(
      seedFacility({ id: "fac_a", name: "A 会議室" }),
      seedFacility({ id: "fac_closed", name: "B 会議室", isActive: false }),
    );

    const result = await createFacilityAvailabilityCalendarQuery(
      testDb.db,
    ).findByFacilityAndPeriods({ facilityId: "fac_closed", periods });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });
});
