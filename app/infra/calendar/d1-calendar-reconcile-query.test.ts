import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "../d1-test-seeds";
import { createD1CalendarReconcileQuery } from "./d1-calendar-reconcile-query";

const testDb = useD1TestDb();

const rangeStart = new Date("2026-10-09T00:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_test", name: "テストユーザー", email: "test@example.com" }),
    seedGroup({ id: "grp_test", name: "テストグループ" }),
    // 有効で Google Calendar ID あり
    seedFacility({
      id: "fac_active_with_cal",
      name: "吹田：3Dプリンター",
      googleCalendarId: "cal_active@example.com",
      isActive: true,
    }),
    // 無効だが Google Calendar ID あり
    seedFacility({
      id: "fac_inactive_with_cal",
      name: "吹田：旧レーザーカッター",
      googleCalendarId: "cal_inactive@example.com",
      isActive: false,
    }),
    // Google Calendar ID が null
    seedFacility({
      id: "fac_no_cal",
      name: "吹田：ミーティングスペース",
      googleCalendarId: null,
      isActive: true,
    }),
    // Google Calendar ID が空文字
    seedFacility({
      id: "fac_empty_cal",
      name: "吹田：作業台",
      googleCalendarId: "   ",
      isActive: true,
    }),
  );
});

describe("createD1CalendarReconcileQuery", () => {
  describe("fetchTargetFacilities", () => {
    it("有効・無効を問わず Google Calendar ID がある施設のみ取得し、null や空文字の施設は除外する", async () => {
      const query = createD1CalendarReconcileQuery(testDb.db);
      const result = await query.fetchTargetFacilities();

      expect(result.isOk()).toBe(true);
      const facilities = result._unsafeUnwrap();

      expect(facilities).toHaveLength(2);

      const activeFac = facilities.find((f) => f.id === "fac_active_with_cal")!;
      expect(activeFac).toBeDefined();
      expect(activeFac.name).toBe("吹田：3Dプリンター");
      expect(activeFac.googleCalendarId).toBe("cal_active@example.com");

      const inactiveFac = facilities.find((f) => f.id === "fac_inactive_with_cal")!;
      expect(inactiveFac).toBeDefined();
      expect(inactiveFac.name).toBe("吹田：旧レーザーカッター");
      expect(inactiveFac.googleCalendarId).toBe("cal_inactive@example.com");

      expect(facilities.some((f) => f.id === "fac_no_cal")).toBe(false);
      expect(facilities.some((f) => f.id === "fac_empty_cal")).toBe(false);
    });
  });

  describe("fetchApprovedReservations", () => {
    it("引数が空配列の場合はクエリを発行せず空配列を返す", async () => {
      const query = createD1CalendarReconcileQuery(testDb.db);
      const result = await query.fetchApprovedReservations([], rangeStart);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it("範囲（endAt >= rangeStart）・状態（approved）・施設で正しく絞り込む", async () => {
      const query = createD1CalendarReconcileQuery(testDb.db);

      await testDb.seed(
        // 1. 対象: fac_active_with_cal, 承認済み, endAt >= rangeStart
        seedReservation({
          id: "res_ok_1",
          groupId: "grp_test",
          facilityId: "fac_active_with_cal",
          status: ReservationStatus.Approved,
          startAt: new Date("2026-10-09T10:00:00.000Z"),
          endAt: new Date("2026-10-09T12:00:00.000Z"),
          headCount: 2,
          createdBy: "usr_test",
        }),
        // 2. 対象: fac_inactive_with_cal, 承認済み, endAt >= rangeStart
        seedReservation({
          id: "res_ok_2",
          groupId: "grp_test",
          facilityId: "fac_inactive_with_cal",
          status: ReservationStatus.Approved,
          startAt: new Date("2026-10-09T13:00:00.000Z"),
          endAt: new Date("2026-10-09T15:00:00.000Z"),
          headCount: 3,
          createdBy: "usr_test",
        }),
        // 3. 対象外: endAt が rangeStart より前（過去の予約）
        seedReservation({
          id: "res_past",
          groupId: "grp_test",
          facilityId: "fac_active_with_cal",
          status: ReservationStatus.Approved,
          startAt: new Date("2026-10-08T10:00:00.000Z"),
          endAt: new Date("2026-10-08T12:00:00.000Z"),
          headCount: 1,
          createdBy: "usr_test",
        }),
        // 4. 対象外: 仮予約（provisional）
        seedReservation({
          id: "res_provisional",
          groupId: "grp_test",
          facilityId: "fac_active_with_cal",
          status: ReservationStatus.Provisional,
          startAt: new Date("2026-10-09T10:00:00.000Z"),
          endAt: new Date("2026-10-09T12:00:00.000Z"),
          headCount: 2,
          createdBy: "usr_test",
        }),
        // 5. 対象外: キャンセル済み（cancelled）
        seedReservation({
          id: "res_cancelled",
          groupId: "grp_test",
          facilityId: "fac_active_with_cal",
          status: ReservationStatus.Cancelled,
          startAt: new Date("2026-10-09T10:00:00.000Z"),
          endAt: new Date("2026-10-09T12:00:00.000Z"),
          headCount: 2,
          createdBy: "usr_test",
        }),
        // 6. 対象外: 別施設（fac_no_cal）の予約
        seedReservation({
          id: "res_other_fac",
          groupId: "grp_test",
          facilityId: "fac_no_cal",
          status: ReservationStatus.Approved,
          startAt: new Date("2026-10-09T10:00:00.000Z"),
          endAt: new Date("2026-10-09T12:00:00.000Z"),
          headCount: 1,
          createdBy: "usr_test",
        }),
      );

      const result = await query.fetchApprovedReservations(
        ["fac_active_with_cal", "fac_inactive_with_cal"],
        rangeStart,
      );

      expect(result.isOk()).toBe(true);
      const rows = result._unsafeUnwrap();

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual(["res_ok_1", "res_ok_2"]);
    });
  });
});
