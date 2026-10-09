import { okAsync, errAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CalendarErrorCode,
  CalendarSyncTaskErrorCode,
  toCalendarEventId,
  type CalendarClient,
  type CalendarError,
  type CalendarSyncTasks,
  type ManagedCalendarEvent,
} from "~/domain/calendar";
import type {
  CalendarReconcileFacility,
  CalendarReconcileQuery,
  CalendarReconcileReservation,
} from "~/query/calendar/calendar-reconcile-query";
import { reconcileCalendarsUseCase, toExpectedCalendarEvents } from "./reconcile-calendars";

const now = new Date("2026-10-10T04:00:00+09:00");
const startAt = new Date("2026-10-10T10:00:00+09:00");
const endAt = new Date("2026-10-10T12:00:00+09:00");

const createFakeQuery = (
  facilities: readonly CalendarReconcileFacility[],
  reservations: readonly CalendarReconcileReservation[],
): CalendarReconcileQuery => ({
  fetchTargetFacilities: () => okAsync(facilities),
  fetchApprovedReservations: () => okAsync(reservations),
});

const createFakeClient = (
  listManagedEvents: CalendarClient["listManagedEvents"],
): CalendarClient => ({
  upsertEvent: vi.fn(),
  deleteEvent: vi.fn(),
  checkWriteAccess: vi.fn(),
  listManagedEvents: vi.fn(listManagedEvents),
});

const createFakeCalendarSyncTasks = (): CalendarSyncTasks => ({
  claimDue: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  enqueue: vi.fn().mockReturnValue(okAsync(undefined)),
});

const toManagedEvent = (
  reservationId: string,
  overrides?: Partial<ManagedCalendarEvent>,
): ManagedCalendarEvent => ({
  eventId: toCalendarEventId(reservationId),
  reservationId,
  summary: "吹田：3Dプリンター",
  startAt,
  endAt,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(events).toEqual([
      {
        calendarId: "cal_1@example.com",
        eventId: toCalendarEventId("res_1"),
        summary: "吹田：3Dプリンター",
        startAt,
        endAt,
        reservationId: "res_1",
      },
    ]);
  });
});

describe("reconcileCalendarsUseCase", () => {
  it("差異（登録漏れ・食い違い・余分な予定）がすべて検出され、同期タスクとして積まれる", async () => {
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "吹田：3Dプリンター 新名称", googleCalendarId: "cal_1@example.com" },
    ];
    const reservations: CalendarReconcileReservation[] = [
      { id: "res_match", facilityId: "fac_1", startAt, endAt },
      { id: "res_missing", facilityId: "fac_1", startAt, endAt },
      { id: "res_changed", facilityId: "fac_1", startAt, endAt },
    ];
    const actualEvents = [
      toManagedEvent("res_match", { summary: "吹田：3Dプリンター 新名称" }),
      // 施設の名称を変える前のタイトルのまま
      toManagedEvent("res_changed", { summary: "吹田：3Dプリンター 旧名称" }),
      // DB に承認済みの予約が無い
      toManagedEvent("res_extra"),
    ];

    const calendarSyncTasks = createFakeCalendarSyncTasks();
    const result = await reconcileCalendarsUseCase(
      {
        query: createFakeQuery(facilities, reservations),
        calendarClient: createFakeClient(() => okAsync(actualEvents)),
        calendarSyncTasks,
      },
      { now },
    );

    expect(result).toEqual({ facilityCount: 1, unreadableFacilityCount: 0, taskCount: 3 });
    expect(calendarSyncTasks.enqueue).toHaveBeenCalledWith({
      drafts: [
        { reservationId: "res_missing", previousFacilityId: null },
        { reservationId: "res_changed", previousFacilityId: null },
        { reservationId: "res_extra", previousFacilityId: "fac_1" },
      ],
      now,
    });
  });

  it("別の施設に移った予約は、移った先への登録と元の施設からの削除の両方を積む", async () => {
    // 移った先の施設が先に並んでいても、元の施設からの削除の draft が捨てられないこと
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_new", name: "施設（新）", googleCalendarId: "cal_new@example.com" },
      { id: "fac_old", name: "施設（旧）", googleCalendarId: "cal_old@example.com" },
    ];
    const reservations: CalendarReconcileReservation[] = [
      { id: "res_moved", facilityId: "fac_new", startAt, endAt },
    ];

    const calendarSyncTasks = createFakeCalendarSyncTasks();
    const result = await reconcileCalendarsUseCase(
      {
        query: createFakeQuery(facilities, reservations),
        calendarClient: createFakeClient((calendarId) =>
          okAsync(calendarId === "cal_old@example.com" ? [toManagedEvent("res_moved")] : []),
        ),
        calendarSyncTasks,
      },
      { now },
    );

    expect(result.taskCount).toBe(2);
    expect(calendarSyncTasks.enqueue).toHaveBeenCalledWith({
      drafts: [
        { reservationId: "res_moved", previousFacilityId: null },
        { reservationId: "res_moved", previousFacilityId: "fac_old" },
      ],
      now,
    });
  });

  it("1 つの施設の読み込みが失敗しても他の施設の draft が積まれ、設定の誤りは error で残る", async () => {
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "施設1", googleCalendarId: "cal_1@example.com" },
      { id: "fac_2", name: "施設2", googleCalendarId: "cal_2@example.com" },
    ];
    const reservations: CalendarReconcileReservation[] = [
      { id: "res_1", facilityId: "fac_1", startAt, endAt },
      { id: "res_2", facilityId: "fac_2", startAt, endAt },
    ];
    const notFound: CalendarError = {
      code: CalendarErrorCode.NotFound,
      message: "カレンダーが見つかりません。",
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const calendarSyncTasks = createFakeCalendarSyncTasks();
    const result = await reconcileCalendarsUseCase(
      {
        query: createFakeQuery(facilities, reservations),
        calendarClient: createFakeClient((calendarId) =>
          calendarId === "cal_1@example.com" ? errAsync(notFound) : okAsync([]),
        ),
        calendarSyncTasks,
      },
      { now },
    );

    expect(result).toEqual({ facilityCount: 2, unreadableFacilityCount: 1, taskCount: 1 });
    expect(calendarSyncTasks.enqueue).toHaveBeenCalledWith({
      drafts: [{ reservationId: "res_2", previousFacilityId: null }],
      now,
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("施設 fac_1 "), notFound);
    // 事務局が入力した Calendar ID と施設名はログの文に埋め込まない（ADR-004）
    const [message] = errorSpy.mock.calls[0]!;
    expect(message).not.toContain("cal_1@example.com");
    expect(message).not.toContain("施設1");
  });

  it("一時的な読み込みの失敗は warn で残す", async () => {
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "施設1", googleCalendarId: "cal_1@example.com" },
    ];
    const unavailable: CalendarError = {
      code: CalendarErrorCode.Unavailable,
      message: "Google Calendar に接続できません。",
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const calendarSyncTasks = createFakeCalendarSyncTasks();
    const result = await reconcileCalendarsUseCase(
      {
        query: createFakeQuery(facilities, []),
        calendarClient: createFakeClient(() => errAsync(unavailable)),
        calendarSyncTasks,
      },
      { now },
    );

    expect(result).toEqual({ facilityCount: 1, unreadableFacilityCount: 1, taskCount: 0 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("施設 fac_1 "), unavailable);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(calendarSyncTasks.enqueue).not.toHaveBeenCalled();
  });

  it("Google Calendar ID の無い施設しか無ければ、カレンダーを読まず何も積まない", async () => {
    // クエリは Calendar ID のある施設だけを返す
    const calendarClient = createFakeClient(() => okAsync([]));
    const calendarSyncTasks = createFakeCalendarSyncTasks();

    const result = await reconcileCalendarsUseCase(
      { query: createFakeQuery([], []), calendarClient, calendarSyncTasks },
      { now },
    );

    expect(result).toEqual({ facilityCount: 0, unreadableFacilityCount: 0, taskCount: 0 });
    expect(calendarClient.listManagedEvents).not.toHaveBeenCalled();
    expect(calendarSyncTasks.enqueue).not.toHaveBeenCalled();
  });

  it("タスクを積めなかったときは積んだ数を 0 として返す", async () => {
    const facilities: CalendarReconcileFacility[] = [
      { id: "fac_1", name: "施設1", googleCalendarId: "cal_1@example.com" },
    ];
    const reservations: CalendarReconcileReservation[] = [
      { id: "res_1", facilityId: "fac_1", startAt, endAt },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const calendarSyncTasks = createFakeCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.enqueue).mockReturnValue(
      errAsync({
        code: CalendarSyncTaskErrorCode.DatabaseError,
        message: "カレンダー同期タスクの操作に失敗しました。",
      }),
    );

    const result = await reconcileCalendarsUseCase(
      {
        query: createFakeQuery(facilities, reservations),
        calendarClient: createFakeClient(() => okAsync([])),
        calendarSyncTasks,
      },
      { now },
    );

    expect(result).toEqual({ facilityCount: 1, unreadableFacilityCount: 0, taskCount: 0 });
    expect(errorSpy).toHaveBeenCalled();
  });
});
