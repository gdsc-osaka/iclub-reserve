import { describe, expect, it } from "vitest";

import type { CalendarEvent, ManagedCalendarEvent } from "./calendar-event";
import { diffCalendarEvents } from "./reconcile";

const facilityId = "fac_target_123";

const createExpectedEvent = (overrides?: Partial<CalendarEvent>): CalendarEvent => ({
  calendarId: "cal_1",
  eventId: "iclub7265735f31",
  summary: "吹田：3Dプリンター",
  startAt: new Date("2026-10-10T10:00:00.000Z"),
  endAt: new Date("2026-10-10T12:00:00.000Z"),
  reservationId: "res_1",
  ...overrides,
});

const createActualEvent = (overrides?: Partial<ManagedCalendarEvent>): ManagedCalendarEvent => ({
  eventId: "iclub7265735f31",
  reservationId: "res_1",
  summary: "吹田：3Dプリンター",
  startAt: new Date("2026-10-10T10:00:00.000Z"),
  endAt: new Date("2026-10-10T12:00:00.000Z"),
  ...overrides,
});

describe("diffCalendarEvents", () => {
  it("一致（差異なし）の場合は空配列を返す", () => {
    const expected = [createExpectedEvent()];
    const actual = [createActualEvent()];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([]);
  });

  it("登録漏れ（expected にあって actual に無い）は previousFacilityId: null のタスクを返す", () => {
    const expected = [createExpectedEvent({ reservationId: "res_missing" })];
    const actual: ManagedCalendarEvent[] = [];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      {
        reservationId: "res_missing",
        previousFacilityId: null,
      },
    ]);
  });

  it("タイトルの食い違い（施設名称の変更など）は previousFacilityId: null のタスクを返す", () => {
    const expected = [
      createExpectedEvent({
        reservationId: "res_1",
        summary: "吹田：3Dプリンター 新名称",
      }),
    ];
    const actual = [
      createActualEvent({
        reservationId: "res_1",
        summary: "吹田：3Dプリンター 旧名称",
      }),
    ];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      {
        reservationId: "res_1",
        previousFacilityId: null,
      },
    ]);
  });

  it("時刻の食い違い（開始または終了日時が異なる）は previousFacilityId: null のタスクを返す", () => {
    const expected = [
      createExpectedEvent({
        reservationId: "res_1",
        startAt: new Date("2026-10-10T10:00:00.000Z"),
        endAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    ];
    const actual = [
      createActualEvent({
        reservationId: "res_1",
        startAt: new Date("2026-10-10T11:00:00.000Z"), // 開始時刻が異なる
        endAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    ];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      {
        reservationId: "res_1",
        previousFacilityId: null,
      },
    ]);
  });

  it("タイムゾーン表記が異なるだけで同じ時刻を表す場合は一致とみなす（空配列）", () => {
    const expected = [
      createExpectedEvent({
        reservationId: "res_1",
        startAt: new Date("2026-10-10T19:00:00+09:00"),
        endAt: new Date("2026-10-10T21:00:00+09:00"),
      }),
    ];
    const actual = [
      createActualEvent({
        reservationId: "res_1",
        startAt: new Date("2026-10-10T10:00:00.000Z"), // +09:00 の 19:00 と UTC 10:00 は同一時刻
        endAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    ];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([]);
  });

  it("余分な予定（actual にあって expected に無い）は previousFacilityId に対象施設 ID を設定したタスクを返す", () => {
    const expected: CalendarEvent[] = [];
    const actual = [createActualEvent({ reservationId: "res_extra" })];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      {
        reservationId: "res_extra",
        previousFacilityId: facilityId,
      },
    ]);
  });

  it("登録漏れ・食い違い・余分な予定が混在する場合、すべてを正しく検出する", () => {
    const expected = [
      createExpectedEvent({ reservationId: "res_matched" }),
      createExpectedEvent({ reservationId: "res_missing" }),
      createExpectedEvent({
        reservationId: "res_modified",
        summary: "更新後タイトル",
      }),
    ];
    const actual = [
      createActualEvent({ reservationId: "res_matched" }),
      createActualEvent({
        reservationId: "res_modified",
        summary: "更新前タイトル",
      }),
      createActualEvent({ reservationId: "res_extra_1" }),
      createActualEvent({ reservationId: "res_extra_2" }),
    ];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      { reservationId: "res_missing", previousFacilityId: null },
      { reservationId: "res_modified", previousFacilityId: null },
      { reservationId: "res_extra_1", previousFacilityId: facilityId },
      { reservationId: "res_extra_2", previousFacilityId: facilityId },
    ]);
  });

  it("同一予約 ID の draft は重複させない", () => {
    const expected = [
      createExpectedEvent({ reservationId: "res_dup" }),
      createExpectedEvent({ reservationId: "res_dup" }),
    ];
    const actual = [
      createActualEvent({ reservationId: "res_extra_dup" }),
      createActualEvent({ reservationId: "res_extra_dup" }),
    ];

    const drafts = diffCalendarEvents(expected, actual, facilityId);
    expect(drafts).toEqual([
      { reservationId: "res_dup", previousFacilityId: null },
      { reservationId: "res_extra_dup", previousFacilityId: facilityId },
    ]);
  });
});
