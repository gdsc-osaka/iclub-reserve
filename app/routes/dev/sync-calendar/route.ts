import { env } from "cloudflare:workers";
import { data, type ActionFunctionArgs } from "react-router";
import { createCalendarClient } from "~/infra/calendar/calendar-client-factory.server";
import { createD1CalendarReconcileQuery } from "~/infra/calendar/d1-calendar-reconcile-query";
import { createD1CalendarSyncQuery } from "~/infra/calendar/d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "~/infra/calendar/d1-calendar-sync-tasks";
import { createDb } from "~/infra/db";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";
import { reconcileCalendarsUseCase } from "~/usecases/calendar/reconcile-calendars";

/**
 * 開発専用のカレンダー同期手動実行エンドポイント（ADR-008）。
 *
 * react-router dev では cron が自動では走らないため、
 * 手動で calendar_sync_task の回収・同期を実行できるようにする。
 * フォーム値 reconcile=1（またはクエリパラメータ reconcile=1）が渡された場合は、
 * 同期タスクの処理に先立って予約とカレンダーの日次突き合わせを実行する。
 * 本番やプレビューで実行されるのを防ぐため、APP_ENV が local 以外のときは 404 を返す。
 */
export async function action({ request }: ActionFunctionArgs) {
  if (env.APP_ENV !== "local") {
    throw new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const formData = await request.formData().catch(() => new FormData());
  const shouldReconcile =
    formData.get("reconcile") === "1" || url.searchParams.get("reconcile") === "1";

  const db = createDb(env.DB);
  const calendarClient = createCalendarClient();

  let reconcileResult = null;
  if (shouldReconcile) {
    const reconcileQuery = createD1CalendarReconcileQuery(db);
    reconcileResult = await reconcileCalendarsUseCase({
      query: reconcileQuery,
      calendarClient,
      db,
    });
  }

  const calendarSyncTasks = createD1CalendarSyncTasks(db);
  const query = createD1CalendarSyncQuery(db);

  const syncResult = await processCalendarSyncTasksUseCase({
    calendarSyncTasks,
    query,
    calendarClient,
  });

  return data({
    ...syncResult,
    reconcile: reconcileResult,
  });
}
