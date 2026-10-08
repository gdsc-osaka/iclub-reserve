import { env } from "cloudflare:workers";
import { data } from "react-router";
import { createCalendarClient } from "~/infra/calendar/calendar-client-factory.server";
import { createD1CalendarSyncQuery } from "~/infra/calendar/d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "~/infra/calendar/d1-calendar-sync-tasks";
import { createDb } from "~/infra/db";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";

/**
 * 開発専用のカレンダー同期手動実行エンドポイント（ADR-008）。
 *
 * react-router dev では cron が自動では走らないため、
 * 手動で calendar_sync_task の回収・同期を実行できるようにする。
 * 本番やプレビューで実行されるのを防ぐため、APP_ENV が local 以外のときは 404 を返す。
 */
export async function action() {
  if (env.APP_ENV !== "local") {
    throw new Response(null, { status: 404 });
  }

  const db = createDb(env.DB);
  const calendarSyncTasks = createD1CalendarSyncTasks(db);
  const query = createD1CalendarSyncQuery(db);
  const calendarClient = createCalendarClient();

  const result = await processCalendarSyncTasksUseCase({
    calendarSyncTasks,
    query,
    calendarClient,
  });

  return data(result);
}
