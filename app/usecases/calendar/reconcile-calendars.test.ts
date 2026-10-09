import { okAsync, errAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { calendarSyncTaskTable } from "~/db/schema";
import {
  CalendarErrorCode,
  toCalendarEventId,
  type CalendarClient,
  type CalendarError,
  type ManagedCalendarEvent,
} from "~/domain/calendar";
import { useD1TestDb } from "~/infra/d1-test-db";
import type {
  CalendarReconcileFacility,
  CalendarReconcileQuery,
  CalendarReconcileReservation,
} from "~/query/calendar/calendar-reconcile-query";
import {
  reconcileCalendarsUseCase,
  toExpectedCalendarEvents,
  toUniqueCalendarSyncTaskDrafts,
} from "./reconcile-calendars";

const testDb = useD1TestDb();

const now = new Date("2026-10-10T04:00:00+09:00");
const startAt = new Date("2026-10-10T10:00:00+09:00");
const endAt = new Date("2026-10-10T12:00:00+09:00");

describe("toExpectedCalendarEvents", () => {
  it("予約情報からあるべき予定を組み立てる", () => {
    const reservations: CalendarReconcileReservation[] = [
      { id: "res_1", facilityId: "fac_1", startAt, endAt },
    ];
    const facility: CalendarReconcileFacility = {
      id: "fac_1",
      name: "吹田：3Dプリンター",
      googleCalendarId: "cal_1@example.com",
    };

    const events = toExpectedCalendarEvents(reservations, facility);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      calendarId: "cal_1@example.com",
      eventId: toCalendarEventId("res_1"),
      summary: "吹田：3Dプリンター",
      startAt,
      endAt,
      reservationId: "res_1",
    });
  });
});

describe("toUniqueCalendarSyncTaskDrafts", () => {
  it("重複する予約 ID を除外する", () => {
    const drafts = [
      { reservationId: "res_1", previousFacilityId: null },
      { reservationId: "res_1", previousFacilityId: "fac_prev" },
      { reservationId: "res_2", previousFacilityId: null },
    ];

    const unique = toUniqueCalendarSyncTaskDrafts(drafts);
    expect(unique).toEqual([
      { reservationId: "res_1", previousFacilityId: null },
      { reservationId: "res_2", previousFacilityId: null },
    ]);
  });
});

describe("reconcileCalendarsUseCase", () => {
  it("1 つの施設の読み込みが失敗しても他の施設の draft が積まれ、読めなかった施設がカウントされる", async () => {
    // 施設 1 (fac_1: cal_1) -> listManagedEvents が失敗する
    // 施設 2 (fac_2: cal_2) -> listManagedEvents が成功し、登録漏れがある
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "施設1", googleCalendarId: "cal_1@example.com" },
      { id: "fac_2", name: "施設2", googleCalendarId: "cal_2@example.com" },
    ];

    const reservations: CalendarReconcileReservation[] = [
      { id: "res_1", facilityId: "fac_1", startAt, endAt },
      { id: "res_2", facilityId: "fac_2", startAt, endAt },
    ];

    const fakeQuery: CalendarReconcileQuery = {
      fetchTargetFacilities: () => okAsync(facilities),
      fetchApprovedReservations: () => okAsync(reservations),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fakeClient: CalendarClient = {
      upsertEvent: vi.fn(),
      deleteEvent: vi.fn(),
      checkWriteAccess: vi.fn(),
      listManagedEvents: (calendarId: string) => {
        if (calendarId === "cal_1@example.com") {
          const error: CalendarError = {
            code: CalendarErrorCode.NotFound,
            message: "Calendar not found",
          };
          return errAsync(error);
        }
        // fac_2: カレンダー側には何も予定がない（登録漏れの状態）
        return okAsync([]);
      },
    };

    const result = await reconcileCalendarsUseCase(
      {
        query: fakeQuery,
        calendarClient: fakeClient,
        db: testDb.db,
      },
      { now },
    );

    expect(result).toEqual({
      facilityCount: 2,
      unreadableFacilityCount: 1,
      taskCount: 1, // fac_2 の res_2 分のみ
    });

    // 失敗した施設に対する警告ログが出力されていること
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("施設 fac_1 (施設1) のカレンダー"),
      expect.objectContaining({ code: CalendarErrorCode.NotFound }),
    );

    // DB に fac_2 のタスクのみが積まれていること
    const rows = await testDb.db.select().from(calendarSyncTaskTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reservationId).toBe("res_2");
    expect(rows[0]!.previousFacilityId).toBeNull();

    warnSpy.mockRestore();
  });

  it("Google Calendar ID の無い施設は対象に含まれず、同期タスクも積まれない", async () => {
    // クエリは Calendar ID のある施設のみ返す仕様
    const fakeQuery: CalendarReconcileQuery = {
      fetchTargetFacilities: () => okAsync([]),
      fetchApprovedReservations: () => okAsync([]),
    };

    const listSpy = vi.fn();
    const fakeClient: CalendarClient = {
      upsertEvent: vi.fn(),
      deleteEvent: vi.fn(),
      checkWriteAccess: vi.fn(),
      listManagedEvents: listSpy,
    };

    const result = await reconcileCalendarsUseCase(
      {
        query: fakeQuery,
        calendarClient: fakeClient,
        db: testDb.db,
      },
      { now },
    );

    expect(result).toEqual({
      facilityCount: 0,
      unreadableFacilityCount: 0,
      taskCount: 0,
    });
    expect(listSpy).not.toHaveBeenCalled();

    const rows = await testDb.db.select().from(calendarSyncTaskTable);
    expect(rows).toHaveLength(0);
  });

  it("差異（登録漏れ・食い違い・余分な予定）がすべて正しく検出され、calendar_sync_task に投入される", async () => {
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "吹田：3Dプリンター 新名称", googleCalendarId: "cal_1@example.com" },
    ];

    const reservations: CalendarReconcileReservation[] = [
      // 1. 一致
      { id: "res_match", facilityId: "fac_1", startAt, endAt },
      // 2. 登録漏れ
      { id: "res_missing", facilityId: "fac_1", startAt, endAt },
      // 3. タイトル食い違い（施設名称が変更された）
      { id: "res_changed", facilityId: "fac_1", startAt, endAt },
    ];

    const actualEvents: ManagedCalendarEvent[] = [
      // 一致
      {
        eventId: toCalendarEventId("res_match"),
        reservationId: "res_match",
        summary: "吹田：3Dプリンター 新名称",
        startAt,
        endAt,
      },
      // タイトル食い違い（古い施設名称）
      {
        eventId: toCalendarEventId("res_changed"),
        reservationId: "res_changed",
        summary: "吹田：3Dプリンター 旧名称",
        startAt,
        endAt,
      },
      // 余分な予定（DB 上に存在しない予約）
      {
        eventId: toCalendarEventId("res_extra"),
        reservationId: "res_extra",
        summary: "吹田：3Dプリンター",
        startAt,
        endAt,
      },
    ];

    const fakeQuery: CalendarReconcileQuery = {
      fetchTargetFacilities: () => okAsync(facilities),
      fetchApprovedReservations: () => okAsync(reservations),
    };

    const fakeClient: CalendarClient = {
      upsertEvent: vi.fn(),
      deleteEvent: vi.fn(),
      checkWriteAccess: vi.fn(),
      listManagedEvents: () => okAsync(actualEvents),
    };

    const result = await reconcileCalendarsUseCase(
      {
        query: fakeQuery,
        calendarClient: fakeClient,
        db: testDb.db,
      },
      { now },
    );

    expect(result).toEqual({
      facilityCount: 1,
      unreadableFacilityCount: 0,
      taskCount: 3, // res_missing, res_changed, res_extra
    });

    const rows = await testDb.db.select().from(calendarSyncTaskTable);
    expect(rows).toHaveLength(3);

    const missingRow = rows.find((r) => r.reservationId === "res_missing")!;
    expect(missingRow).toBeDefined();
    expect(missingRow.previousFacilityId).toBeNull();

    const changedRow = rows.find((r) => r.reservationId === "res_changed")!;
    expect(changedRow).toBeDefined();
    expect(changedRow.previousFacilityId).toBeNull();

    const extraRow = rows.find((r) => r.reservationId === "res_extra")!;
    expect(extraRow).toBeDefined();
    expect(extraRow.previousFacilityId).toBe("fac_1");
  });
});
