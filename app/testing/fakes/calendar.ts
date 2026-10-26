/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { CalendarClient } from "~/domain/calendar/calendar-client";
import type { CalendarSyncTasks } from "~/domain/calendar/calendar-sync-task";
import type { GroupCalendarFeedRepository } from "~/domain/calendar/group-calendar-feed-repository";
import type { CalendarReconcileQuery } from "~/query/calendar/calendar-reconcile-query";
import type { CalendarSyncQuery } from "~/query/calendar/calendar-sync-query";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の CalendarClient の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeCalendarClient(overrides: Partial<CalendarClient> = {}): CalendarClient {
  return createUnimplementedFake("CalendarClient", overrides);
}

/**
 * テスト用の CalendarSyncTasks の偽物を生成する。
 */
export function fakeCalendarSyncTasks(
  overrides: Partial<CalendarSyncTasks> = {},
): CalendarSyncTasks {
  return createUnimplementedFake("CalendarSyncTasks", overrides);
}

/**
 * テスト用の CalendarSyncQuery の偽物を生成する。
 */
export function fakeCalendarSyncQuery(
  overrides: Partial<CalendarSyncQuery> = {},
): CalendarSyncQuery {
  return createUnimplementedFake("CalendarSyncQuery", overrides);
}

/**
 * テスト用の CalendarReconcileQuery の偽物を生成する。
 */
export function fakeCalendarReconcileQuery(
  overrides: Partial<CalendarReconcileQuery> = {},
): CalendarReconcileQuery {
  return createUnimplementedFake("CalendarReconcileQuery", overrides);
}

/**
 * テスト用の GroupCalendarFeedRepository の偽物を生成する。
 */
export function fakeGroupCalendarFeedRepository(
  overrides: Partial<GroupCalendarFeedRepository> = {},
): GroupCalendarFeedRepository {
  return createUnimplementedFake("GroupCalendarFeedRepository", overrides);
}
