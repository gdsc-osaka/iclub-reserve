import { okAsync, errAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  CalendarErrorCode,
  toCalendarEventId,
  type CalendarClient,
  type CalendarError,
  type CalendarEvent,
  type CalendarSyncTask,
  type CalendarSyncTasks,
} from "~/domain/calendar";
import { ReservationStatus } from "~/domain/reservation";
import type { CalendarSyncQuery } from "~/query/calendar/calendar-sync-query";
import {
  processCalendarSyncTasksUseCase,
  toDeleteCalendarIds,
  toReservationSyncGroups,
} from "./process-calendar-sync-tasks";

const startAt = new Date("2026-10-10T10:00:00.000Z");
const endAt = new Date("2026-10-10T12:00:00.000Z");

const createMockTask = (overrides?: Partial<CalendarSyncTask>): CalendarSyncTask => ({
  id: 1,
  reservationId: "res_1",
  previousFacilityId: null,
  attemptCount: 0,
  ...overrides,
});

describe("toReservationSyncGroups", () => {
  it("タスクを予約 ID ごとにまとめ、重複する変更前施設 ID を Set に集約する", () => {
    const tasks: CalendarSyncTask[] = [
      createMockTask({ id: 1, reservationId: "res_1", previousFacilityId: "fac_a" }),
      createMockTask({ id: 2, reservationId: "res_2", previousFacilityId: null }),
      createMockTask({ id: 3, reservationId: "res_1", previousFacilityId: "fac_a" }),
      createMockTask({ id: 4, reservationId: "res_1", previousFacilityId: "fac_b" }),
    ];

    const groups = toReservationSyncGroups(tasks);
    expect(groups).toHaveLength(2);

    const group1 = groups.find((g) => g.reservationId === "res_1")!;
    expect(group1.taskIds).toEqual([1, 3, 4]);
    expect(Array.from(group1.previousFacilityIds)).toEqual(["fac_a", "fac_b"]);
    expect(group1.tasks).toHaveLength(3);

    const group2 = groups.find((g) => g.reservationId === "res_2")!;
    expect(group2.taskIds).toEqual([2]);
    expect(Array.from(group2.previousFacilityIds)).toEqual([]);
  });
});

describe("toDeleteCalendarIds", () => {
  it("あるべき予定がある場合、変更前施設のカレンダーのみを削除対象とし、あるべき予定のカレンダーは除外する", () => {
    const result = toDeleteCalendarIds({
      desiredCalendarId: "cal_current",
      currentFacilityCalendarId: "cal_current",
      previousFacilityCalendarIds: ["cal_prev", "cal_current", null],
    });

    expect(result).toEqual(["cal_prev"]);
  });

  it("あるべき予定が無い場合、現在の施設と変更前施設の両方のカレンダーを削除対象とし、重複を除外する", () => {
    const result = toDeleteCalendarIds({
      desiredCalendarId: null,
      currentFacilityCalendarId: "cal_current",
      previousFacilityCalendarIds: ["cal_prev", "cal_current", ""],
    });

    expect(result).toEqual(["cal_current", "cal_prev"]);
  });

  it("あるべき予定が無く施設も未設定の場合、空配列を返す", () => {
    const result = toDeleteCalendarIds({
      desiredCalendarId: null,
      currentFacilityCalendarId: null,
      previousFacilityCalendarIds: [null, ""],
    });

    expect(result).toEqual([]);
  });
});

describe("processCalendarSyncTasksUseCase", () => {
  const createMockCalendarSyncTasks = (): CalendarSyncTasks => ({
    claimDue: vi.fn().mockReturnValue(okAsync([])),
    complete: vi.fn().mockReturnValue(okAsync(undefined)),
    fail: vi.fn().mockReturnValue(okAsync(undefined)),
  });

  const createMockQuery = (): CalendarSyncQuery => ({
    fetchReservationStates: vi.fn().mockReturnValue(okAsync([])),
    fetchFacilityCalendarIds: vi.fn().mockReturnValue(okAsync([])),
  });

  const createMockCalendarClient = (): CalendarClient => ({
    upsertEvent: vi.fn().mockReturnValue(okAsync(null)),
    deleteEvent: vi.fn().mockReturnValue(okAsync(null)),
    listManagedEvents: vi.fn().mockReturnValue(okAsync([])),
    checkWriteAccess: vi.fn().mockReturnValue(okAsync("writable")),
  });

  it("取り出したタスクが 0 件の場合は何もせず 0 件の結果を返す", async () => {
    const calendarSyncTasks = createMockCalendarSyncTasks();
    const query = createMockQuery();
    const calendarClient = createMockCalendarClient();

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 0, completed: 0, failed: 0, retried: 0, dead: 0 });
    expect(calendarClient.upsertEvent).not.toHaveBeenCalled();
    expect(calendarClient.deleteEvent).not.toHaveBeenCalled();
  });

  it("承認済み予約のタスク: upsertEvent を呼び出し、タスクを complete する", async () => {
    const task = createMockTask({ id: 10, reservationId: "res_approved" });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_approved",
          status: ReservationStatus.Approved,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: {
            name: "会議室1",
            googleCalendarId: "cal_1@group.calendar.google.com",
          },
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(calendarClient.upsertEvent).toHaveBeenCalledWith({
      calendarId: "cal_1@group.calendar.google.com",
      eventId: toCalendarEventId("res_approved"),
      summary: "会議室1",
      startAt,
      endAt,
      reservationId: "res_approved",
    });
    expect(calendarClient.deleteEvent).not.toHaveBeenCalled();
    expect(calendarSyncTasks.complete).toHaveBeenCalledWith([10]);
  });

  it("施設変更（承認済み予約）: 新カレンダーへ upsert し、旧カレンダーから delete する", async () => {
    const task = createMockTask({
      id: 20,
      reservationId: "res_moved",
      previousFacilityId: "fac_old",
    });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_moved",
          status: ReservationStatus.Approved,
          facilityId: "fac_new",
          startAt,
          endAt,
          facility: {
            name: "新施設",
            googleCalendarId: "cal_new@example.com",
          },
        },
      ]),
    );
    vi.mocked(query.fetchFacilityCalendarIds).mockReturnValue(
      okAsync([
        {
          id: "fac_old",
          googleCalendarId: "cal_old@example.com",
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(calendarClient.upsertEvent).toHaveBeenCalledTimes(1);
    expect(calendarClient.deleteEvent).toHaveBeenCalledWith(
      "cal_old@example.com",
      toCalendarEventId("res_moved"),
    );
    expect(calendarSyncTasks.complete).toHaveBeenCalledWith([20]);
  });

  it("キャンセルされた予約: upsert は呼ばず、現カレンダーから delete する", async () => {
    const task = createMockTask({ id: 30, reservationId: "res_cancelled" });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_cancelled",
          status: ReservationStatus.Cancelled,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: {
            name: "施設1",
            googleCalendarId: "cal_1@example.com",
          },
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(calendarClient.upsertEvent).not.toHaveBeenCalled();
    expect(calendarClient.deleteEvent).toHaveBeenCalledWith(
      "cal_1@example.com",
      toCalendarEventId("res_cancelled"),
    );
    expect(calendarSyncTasks.complete).toHaveBeenCalledWith([30]);
  });

  it("DB に存在しない予約: 変更前施設カレンダーからのみ delete する", async () => {
    const task = createMockTask({
      id: 40,
      reservationId: "res_deleted_from_db",
      previousFacilityId: "fac_old",
    });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(okAsync([]));
    vi.mocked(query.fetchFacilityCalendarIds).mockReturnValue(
      okAsync([{ id: "fac_old", googleCalendarId: "cal_old@example.com" }]),
    );

    const calendarClient = createMockCalendarClient();

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(calendarClient.upsertEvent).not.toHaveBeenCalled();
    expect(calendarClient.deleteEvent).toHaveBeenCalledWith(
      "cal_old@example.com",
      toCalendarEventId("res_deleted_from_db"),
    );
    expect(calendarSyncTasks.complete).toHaveBeenCalledWith([40]);
  });

  it("再試行可能なエラーで失敗した場合、fail を呼び retried をインクリメントする", async () => {
    const task = createMockTask({ id: 50, reservationId: "res_fail_retry", attemptCount: 2 });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_fail_retry",
          status: ReservationStatus.Approved,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: { name: "施設1", googleCalendarId: "cal_1@example.com" },
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();
    const rateLimitError: CalendarError = {
      code: CalendarErrorCode.RateLimited,
      message: "Rate limit exceeded",
    };
    vi.mocked(calendarClient.upsertEvent).mockReturnValue(errAsync(rateLimitError));

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1, retried: 1, dead: 0 });
    expect(calendarSyncTasks.fail).toHaveBeenCalledWith({
      ids: [50],
      error: rateLimitError,
      now: expect.any(Date),
    });
    expect(calendarSyncTasks.complete).not.toHaveBeenCalled();
  });

  it("再試行不可のエラー（または上限回数到達）で失敗した場合、dead をインクリメントする", async () => {
    const task = createMockTask({ id: 60, reservationId: "res_fail_perm", attemptCount: 1 });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_fail_perm",
          status: ReservationStatus.Approved,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: { name: "施設1", googleCalendarId: "cal_1@example.com" },
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();
    const authError: CalendarError = {
      code: CalendarErrorCode.AuthFailed,
      message: "Authentication failed",
    };
    vi.mocked(calendarClient.upsertEvent).mockReturnValue(errAsync(authError));

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1, retried: 0, dead: 1 });
    expect(calendarSyncTasks.fail).toHaveBeenCalledWith({
      ids: [60],
      error: authError,
      now: expect.any(Date),
    });
  });

  it("複数予約の同期で 1 つが失敗しても、他の予約の同期は継続して成功する", async () => {
    const task1 = createMockTask({ id: 101, reservationId: "res_ok" });
    const task2 = createMockTask({ id: 102, reservationId: "res_ng" });
    const calendarSyncTasks = createMockCalendarSyncTasks();
    vi.mocked(calendarSyncTasks.claimDue).mockReturnValue(okAsync([task1, task2]));

    const query = createMockQuery();
    vi.mocked(query.fetchReservationStates).mockReturnValue(
      okAsync([
        {
          id: "res_ok",
          status: ReservationStatus.Approved,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: { name: "施設1", googleCalendarId: "cal_1@example.com" },
        },
        {
          id: "res_ng",
          status: ReservationStatus.Approved,
          facilityId: "fac_1",
          startAt,
          endAt,
          facility: { name: "施設1", googleCalendarId: "cal_1@example.com" },
        },
      ]),
    );

    const calendarClient = createMockCalendarClient();
    vi.mocked(calendarClient.upsertEvent).mockImplementation((event: CalendarEvent) => {
      if (event.reservationId === "res_ng") {
        return errAsync({
          code: CalendarErrorCode.Forbidden,
          message: "Forbidden",
        });
      }
      return okAsync(null);
    });

    const result = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(result).toEqual({ claimed: 2, completed: 1, failed: 1, retried: 0, dead: 1 });
    expect(calendarSyncTasks.complete).toHaveBeenCalledWith([101]);
    expect(calendarSyncTasks.fail).toHaveBeenCalledWith({
      ids: [102],
      error: expect.objectContaining({ code: CalendarErrorCode.Forbidden }),
      now: expect.any(Date),
    });
  });
});
