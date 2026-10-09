import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";

import { calendarSyncTaskTable, reservationTable } from "~/db/schema";
import { toCalendarEventId, type CalendarClient, type CalendarEvent } from "~/domain/calendar";
import { FacilityErrorCode, type FacilityRepository } from "~/domain/facility";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { MembershipErrorCode, type MembershipRepository } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import { QueryErrorCode } from "~/query/error";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";
import { editReservationDirectlyUseCase } from "~/usecases/reservation/edit-reservation-directly";
import { useD1TestDb } from "../d1-test-db";
import { createReservationRepository } from "../reservation/reservation-repo";
import { createD1CalendarSyncQuery } from "./d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "./d1-calendar-sync-tasks";

/*
 * 予約の操作から Google Calendar への反映までを、本物の D1 でつないで確かめる。
 *
 * ユースケース → リポジトリ（同期タスクを同じ batch で積む）→ 毎分の同期処理 → CalendarClient
 * の流れのうち、Google への呼び出しだけを記録する偽物に差し替えている。
 * 各部品の細かい分岐は、それぞれの単体テストで確かめている。
 */

const testDb = useD1TestDb();

const testNow = new Date("2026-10-09T09:00:00.000Z");
const startAt = new Date("2026-10-10T10:00:00.000Z");
const endAt = new Date("2026-10-10T12:00:00.000Z");

const calendar1 = "cal_1@group.calendar.google.com";
const calendar2 = "cal_2@group.calendar.google.com";

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
      calendar1,
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, google_calendar_id, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_2",
      "第2会議室",
      calendar2,
      1,
      0,
      0,
    ],
  );
});

/** Google への呼び出しを記録するだけの CalendarClient */
const createRecordingCalendarClient = () => {
  const upserts: CalendarEvent[] = [];
  const deletes: { calendarId: string; eventId: string }[] = [];
  const client: CalendarClient = {
    upsertEvent: (event) => {
      upserts.push(event);
      return okAsync(null);
    },
    deleteEvent: (calendarId, eventId) => {
      deletes.push({ calendarId, eventId });
      return okAsync(null);
    },
    listManagedEvents: () => okAsync([]),
    checkWriteAccess: () => okAsync("writable"),
  };
  return { client, upserts, deletes };
};

const notUsed = { message: "このテストでは使わない" } as const;

/** 事務局の操作なので、所属の確認は通らない（所属していない）前提で足りる */
const membershipRepository: MembershipRepository = {
  findByGroupAndUser: () => okAsync(null),
  countAdmins: () => errAsync({ code: MembershipErrorCode.DatabaseError, ...notUsed }),
  updateRole: () => errAsync({ code: MembershipErrorCode.DatabaseError, ...notUsed }),
  remove: () => errAsync({ code: MembershipErrorCode.DatabaseError, ...notUsed }),
};

const reservationMailRecipientsQuery: ReservationMailRecipientsQuery = {
  findByReservationId: () => okAsync({ groupMembers: [], staff: [] }),
  findForNewReservation: () => errAsync({ code: QueryErrorCode.DatabaseError, ...notUsed }),
  findForMessage: () => errAsync({ code: QueryErrorCode.DatabaseError, ...notUsed }),
};

const mailOutboxNotifier: MailOutboxNotifier = { notifyEnqueued: () => {} };

/** 直接変更で施設を変えるときの「変更先が使えるか」の確認に使う */
const facilityRepository: FacilityRepository = {
  findById: (id) =>
    okAsync({
      id,
      name: id === "fac_1" ? "第1会議室" : "第2会議室",
      description: null,
      isActive: true,
      photoUrl: null,
      googleCalendarId: null,
      calendarUrl: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
  create: () => errAsync({ code: FacilityErrorCode.DatabaseError, ...notUsed }),
  update: () => errAsync({ code: FacilityErrorCode.DatabaseError, ...notUsed }),
  countBlockingReservations: () => errAsync({ code: FacilityErrorCode.DatabaseError, ...notUsed }),
  updateActiveStatus: () => errAsync({ code: FacilityErrorCode.DatabaseError, ...notUsed }),
};

const insertReservation = (id: string, status: ReservationStatus) =>
  testDb.db.insert(reservationTable).values({
    id,
    groupId: "grp_test",
    facilityId: "fac_1",
    status,
    startAt,
    endAt,
    headCount: 3,
    createdBy: "usr_staff",
  });

/**
 * 毎分の同期を 1 回だけ動かす。
 *
 * 時刻は渡さず本物の時計に任せる。同期タスクを積む文は next_attempt_at に本物の時計を使うため、
 * ここで固定の時刻を渡すと、その時刻を過ぎた日からタスクが「まだ期限前」とみなされて取り出されなくなる。
 */
const syncOnce = (calendarClient: CalendarClient) =>
  processCalendarSyncTasksUseCase({
    calendarSyncTasks: createD1CalendarSyncTasks(testDb.db),
    query: createD1CalendarSyncQuery(testDb.db),
    calendarClient,
  });

const remainingTasks = () => testDb.db.select().from(calendarSyncTaskTable);

describe("予約の操作から Google Calendar への反映まで", () => {
  it("仮予約を承認すると、同期で施設のカレンダーに予定が登録され、タスクは消える", async () => {
    await insertReservation("res_flow_1", ReservationStatus.Provisional);

    const approved = await changeReservationStatusUseCase(
      {
        reservationRepository: createReservationRepository(testDb.db),
        membershipRepository,
        reservationMailRecipientsQuery,
        mailOutboxNotifier,
      },
      {
        reservationId: "res_flow_1",
        appBaseUrl: "https://reserve.example.com",
        actorUserId: "usr_staff",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      },
    );
    expect(approved.isOk()).toBe(true);
    expect(await remainingTasks()).toMatchObject([
      { reservationId: "res_flow_1", previousFacilityId: null },
    ]);

    const recorder = createRecordingCalendarClient();
    const result = await syncOnce(recorder.client);

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(recorder.upserts).toEqual([
      {
        calendarId: calendar1,
        eventId: toCalendarEventId("res_flow_1"),
        summary: "第1会議室",
        startAt,
        endAt,
        reservationId: "res_flow_1",
      },
    ]);
    expect(recorder.deletes).toEqual([]);
    expect(await remainingTasks()).toEqual([]);
  });

  it("承認済みの予約を事務局がキャンセルすると、同期で施設のカレンダーから予定が消える", async () => {
    await insertReservation("res_flow_2", ReservationStatus.Approved);

    const cancelled = await changeReservationStatusUseCase(
      {
        reservationRepository: createReservationRepository(testDb.db),
        membershipRepository,
        reservationMailRecipientsQuery,
        mailOutboxNotifier,
      },
      {
        reservationId: "res_flow_2",
        appBaseUrl: "https://reserve.example.com",
        actorUserId: "usr_staff",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        reason: "事務局都合によるキャンセル",
        now: testNow,
      },
    );
    expect(cancelled.isOk()).toBe(true);

    const recorder = createRecordingCalendarClient();
    const result = await syncOnce(recorder.client);

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(recorder.upserts).toEqual([]);
    expect(recorder.deletes).toEqual([
      { calendarId: calendar1, eventId: toCalendarEventId("res_flow_2") },
    ]);
    expect(await remainingTasks()).toEqual([]);
  });

  it("承認済みの予約の施設を事務局が変えると、変更後の施設に登録し、変更前の施設から消す", async () => {
    await insertReservation("res_flow_3", ReservationStatus.Approved);

    const edited = await editReservationDirectlyUseCase(
      {
        reservationRepository: createReservationRepository(testDb.db),
        membershipRepository,
        facilityRepository,
        reservationMailRecipientsQuery,
        mailOutboxNotifier,
      },
      {
        reservationId: "res_flow_3",
        appBaseUrl: "https://reserve.example.com",
        actorUserId: "usr_staff",
        isStaff: true,
        now: testNow,
        content: { facilityId: "fac_2", startAt, endAt, headCount: 3, note: null },
      },
    );
    expect(edited.isOk()).toBe(true);
    expect(await remainingTasks()).toMatchObject([
      { reservationId: "res_flow_3", previousFacilityId: "fac_1" },
    ]);

    const recorder = createRecordingCalendarClient();
    const result = await syncOnce(recorder.client);

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, retried: 0, dead: 0 });
    expect(recorder.upserts).toMatchObject([
      { calendarId: calendar2, eventId: toCalendarEventId("res_flow_3"), summary: "第2会議室" },
    ]);
    expect(recorder.deletes).toEqual([
      { calendarId: calendar1, eventId: toCalendarEventId("res_flow_3") },
    ]);
    expect(await remainingTasks()).toEqual([]);
  });
});
