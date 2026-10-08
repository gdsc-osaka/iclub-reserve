import { beforeEach, describe, expect, it } from "vitest";

import { reservationTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { createD1CalendarSyncQuery } from "./d1-calendar-sync-query";

const testDb = useD1TestDb();

const startAt = new Date("2026-10-10T10:00:00.000Z");
const endAt = new Date("2026-10-10T12:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_test",
      "テストユーザー",
      "test@example.com",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_test",
      "テストグループ",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, google_calendar_id, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_1",
      "施設1",
      "cal_1@example.com",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, google_calendar_id, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_2",
      "施設2",
      null,
      1,
      0,
      0,
    ],
  );
});

describe("createD1CalendarSyncQuery", () => {
  describe("fetchReservationStates", () => {
    it("引数が空配列の場合はクエリを発行せず空配列を返す", async () => {
      const query = createD1CalendarSyncQuery(testDb.db);
      const result = await query.fetchReservationStates([]);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it("予約と施設の情報を結合して最新状態を取得する", async () => {
      const query = createD1CalendarSyncQuery(testDb.db);

      await testDb.db.insert(reservationTable).values([
        {
          id: "res_1",
          groupId: "grp_test",
          facilityId: "fac_1",
          status: ReservationStatus.Approved,
          startAt,
          endAt,
          headCount: 5,
          createdBy: "usr_test",
        },
        {
          id: "res_2",
          groupId: "grp_test",
          facilityId: "fac_2",
          status: ReservationStatus.Provisional,
          startAt,
          endAt,
          headCount: 2,
          createdBy: "usr_test",
        },
      ]);

      const result = await query.fetchReservationStates(["res_1", "res_2", "res_nonexistent"]);
      expect(result.isOk()).toBe(true);

      const rows = result._unsafeUnwrap();
      expect(rows).toHaveLength(2);

      const res1 = rows.find((r) => r.id === "res_1")!;
      expect(res1).toBeDefined();
      expect(res1.status).toBe(ReservationStatus.Approved);
      expect(res1.facilityId).toBe("fac_1");
      expect(res1.startAt.getTime()).toBe(startAt.getTime());
      expect(res1.endAt.getTime()).toBe(endAt.getTime());
      expect(res1.facility).toEqual({
        name: "施設1",
        googleCalendarId: "cal_1@example.com",
      });

      const res2 = rows.find((r) => r.id === "res_2")!;
      expect(res2).toBeDefined();
      expect(res2.status).toBe(ReservationStatus.Provisional);
      expect(res2.facilityId).toBe("fac_2");
      expect(res2.facility).toEqual({
        name: "施設2",
        googleCalendarId: null,
      });
    });
  });

  describe("fetchFacilityCalendarIds", () => {
    it("引数が空配列の場合はクエリを発行せず空配列を返す", async () => {
      const query = createD1CalendarSyncQuery(testDb.db);
      const result = await query.fetchFacilityCalendarIds([]);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it("指定した施設の googleCalendarId を取得する（存在しない施設は含まない）", async () => {
      const query = createD1CalendarSyncQuery(testDb.db);

      const result = await query.fetchFacilityCalendarIds(["fac_1", "fac_2", "fac_nonexistent"]);
      expect(result.isOk()).toBe(true);

      const rows = result._unsafeUnwrap();
      expect(rows).toHaveLength(2);

      const fac1 = rows.find((f) => f.id === "fac_1")!;
      expect(fac1.googleCalendarId).toBe("cal_1@example.com");

      const fac2 = rows.find((f) => f.id === "fac_2")!;
      expect(fac2.googleCalendarId).toBeNull();
    });
  });
});
