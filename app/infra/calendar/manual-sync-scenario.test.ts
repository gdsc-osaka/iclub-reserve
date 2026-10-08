import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { calendarSyncTaskTable, reservationTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import { useD1TestDb } from "../d1-test-db";
import { createReservationRepository } from "../reservation/reservation-repo";
import { createConsoleCalendarClient } from "./console-calendar-client";
import { createD1CalendarSyncQuery } from "./d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "./d1-calendar-sync-tasks";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";
import { editReservationDirectlyUseCase } from "~/usecases/reservation/edit-reservation-directly";

const testDb = useD1TestDb();

const testNow = new Date("2026-10-09T09:00:00.000Z");
const startAt = new Date("2026-10-10T10:00:00.000Z");
const endAt = new Date("2026-10-10T12:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff",
      "スタッフ",
      "staff@example.com",
      1,
      0,
      0,
      1,
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
      "第1会議室",
      "cal_1@group.calendar.google.com",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, google_calendar_id, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_2",
      "第2会議室",
      "cal_2@group.calendar.google.com",
      1,
      0,
      0,
    ],
  );
});

describe("手動検証シナリオの自動化テスト", () => {
  const dummyMembershipRepo = {
    findByGroupAndUser: () => okAsync(null),
    countAdmins: () => okAsync(1),
  };

  const dummyMailQuery = {
    findByReservationId: () =>
      okAsync({
        reservationId: "res_any",
        applicant: null,
        groupMembers: [],
        staffUsers: [],
      }),
  };

  const dummyFacilityRepo = {
    findById: (id: string) =>
      okAsync({
        id,
        name: id === "fac_1" ? "第1会議室" : "第2会議室",
        description: null,
        isActive: true,
        photoUrl: null,
        googleCalendarId: null,
        calendarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  };

  const dummyMailNotifier = {
    notifyEnqueued: () => okAsync(undefined),
  };

  it("シナリオ1: 仮予約承認 → sync → upsert の console 出力確認", async () => {
    const reservationRepo = createReservationRepository(testDb.db);
    const calendarSyncTasks = createD1CalendarSyncTasks(testDb.db);
    const query = createD1CalendarSyncQuery(testDb.db);
    const calendarClient = createConsoleCalendarClient();

    // 1. 仮予約を作成
    await testDb.db.insert(reservationTable).values({
      id: "res_scenario_1",
      groupId: "grp_test",
      facilityId: "fac_1",
      status: ReservationStatus.Provisional,
      startAt,
      endAt,
      headCount: 3,
      createdBy: "usr_staff",
    });

    // 2. 事務局が承認
    const approveResult = await changeReservationStatusUseCase(
      {
        reservationRepository: reservationRepo,
        membershipRepository: dummyMembershipRepo as any,
        reservationMailRecipientsQuery: dummyMailQuery as any,
        mailOutboxNotifier: dummyMailNotifier as any,
      },
      {
        reservationId: "res_scenario_1",
        actorUserId: "usr_staff",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      },
    );
    expect(approveResult.isOk()).toBe(true);

    // 同期タスクが 1 件積まれていることを確認
    const pendingTasks = await testDb.db.select().from(calendarSyncTaskTable);
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]!.reservationId).toBe("res_scenario_1");

    // 3. sync を実行し、upsertEvent のコンソール出力を検証
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const syncResult = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(syncResult).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Google Calendar 予定登録/更新（コンソール出力）"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Calendar ID : cal_1@group.calendar.google.com"),
    );

    // 完了後、タスクが削除されていることを確認
    const remainingTasks = await testDb.db.select().from(calendarSyncTaskTable);
    expect(remainingTasks).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("シナリオ2: 事務局キャンセル → sync → delete の console 出力確認", async () => {
    const reservationRepo = createReservationRepository(testDb.db);
    const calendarSyncTasks = createD1CalendarSyncTasks(testDb.db);
    const query = createD1CalendarSyncQuery(testDb.db);
    const calendarClient = createConsoleCalendarClient();

    // 1. 承認済み予約を作成
    await testDb.db.insert(reservationTable).values({
      id: "res_scenario_2",
      groupId: "grp_test",
      facilityId: "fac_1",
      status: ReservationStatus.Approved,
      startAt,
      endAt,
      headCount: 3,
      createdBy: "usr_staff",
    });

    // 2. 事務局がキャンセル
    const cancelResult = await changeReservationStatusUseCase(
      {
        reservationRepository: reservationRepo,
        membershipRepository: dummyMembershipRepo as any,
        reservationMailRecipientsQuery: dummyMailQuery as any,
        mailOutboxNotifier: dummyMailNotifier as any,
      },
      {
        reservationId: "res_scenario_2",
        actorUserId: "usr_staff",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        reason: "事務局都合によるキャンセル",
        now: testNow,
      },
    );
    expect(cancelResult.isOk()).toBe(true);

    // 3. sync を実行し、deleteEvent のコンソール出力を検証
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const syncResult = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(syncResult).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Google Calendar 予定削除（コンソール出力）"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Calendar ID : cal_1@group.calendar.google.com"),
    );

    const remainingTasks = await testDb.db.select().from(calendarSyncTaskTable);
    expect(remainingTasks).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("シナリオ3: 施設変更 → sync → 新施設 upsert & 旧施設 delete の console 出力確認", async () => {
    const reservationRepo = createReservationRepository(testDb.db);
    const calendarSyncTasks = createD1CalendarSyncTasks(testDb.db);
    const query = createD1CalendarSyncQuery(testDb.db);
    const calendarClient = createConsoleCalendarClient();

    // 1. 承認済み予約を作成（施設1）
    await testDb.db.insert(reservationTable).values({
      id: "res_scenario_3",
      groupId: "grp_test",
      facilityId: "fac_1",
      status: ReservationStatus.Approved,
      startAt,
      endAt,
      headCount: 3,
      createdBy: "usr_staff",
    });

    // 2. 事務局が施設を施設2へ変更
    const editResult = await editReservationDirectlyUseCase(
      {
        reservationRepository: reservationRepo,
        membershipRepository: dummyMembershipRepo as any,
        facilityRepository: dummyFacilityRepo as any,
        reservationMailRecipientsQuery: dummyMailQuery as any,
        mailOutboxNotifier: dummyMailNotifier as any,
      },
      {
        reservationId: "res_scenario_3",
        actorUserId: "usr_staff",
        isStaff: true,
        now: testNow,
        content: {
          facilityId: "fac_2",
          startAt,
          endAt,
          headCount: 3,
          note: null,
        },
      },
    );
    expect(editResult.isOk()).toBe(true);

    // previousFacilityId = fac_1 の同期タスクが積まれていることを確認
    const pendingTasks = await testDb.db.select().from(calendarSyncTaskTable);
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]!.previousFacilityId).toBe("fac_1");

    // 3. sync を実行し、新施設 upsert & 旧施設 delete の両方のコンソール出力を検証
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const syncResult = await processCalendarSyncTasksUseCase({
      calendarSyncTasks,
      query,
      calendarClient,
    });

    expect(syncResult).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });

    // 新施設への upsert
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Google Calendar 予定登録/更新（コンソール出力）"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Calendar ID : cal_2@group.calendar.google.com"),
    );

    // 旧施設からの delete
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Google Calendar 予定削除（コンソール出力）"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Calendar ID : cal_1@group.calendar.google.com"),
    );

    const remainingTasks = await testDb.db.select().from(calendarSyncTaskTable);
    expect(remainingTasks).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});
