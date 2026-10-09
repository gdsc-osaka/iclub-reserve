import { createRequestHandler } from "react-router";
import { createCalendarClient } from "~/infra/calendar/calendar-client-factory.server";
import { createD1CalendarReconcileQuery } from "~/infra/calendar/d1-calendar-reconcile-query";
import { createD1CalendarSyncQuery } from "~/infra/calendar/d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "~/infra/calendar/d1-calendar-sync-tasks";
import { createDb } from "~/infra/db";
import { createD1MailOutbox } from "~/infra/mail/d1-mail-outbox";
import type { MailQueueMessage } from "~/infra/mail/mail-queue.server";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";
import { reconcileCalendarsUseCase } from "~/usecases/calendar/reconcile-calendars";
import {
  flushMailOutboxByIdsUseCase,
  flushMailOutboxUseCase,
} from "~/usecases/mail/flush-mail-outbox.server";

/** 毎分の定期処理の cron 式（wrangler.jsonc の triggers.crons と一致させる） */
export const CRON_EVERY_MINUTE = "* * * * *";

/** 毎日 19:00 UTC（日本時間 4:00）の日次突き合わせ cron 式（wrangler.jsonc の triggers.crons と一致させる） */
export const CRON_DAILY_RECONCILE = "0 19 * * *";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  /**
   * 定期処理（Cron Triggers）。
   * controller.cron の値に応じて毎分の処理と日次の突き合わせを振り分ける。
   *
   * - `* * * * *`: メールの回収と、カレンダー同期タスクの反映
   * - `0 19 * * *`: 予約と Google Calendar の日次突き合わせ（タスクを積むのみ）
   */
  async scheduled(controller, env, _ctx) {
    const cron = controller.cron;
    const db = createDb(env.DB);

    // 1. 毎分の定期処理
    if (cron === CRON_EVERY_MINUTE) {
      // 1-1. メールの回収（ADR-002 実装ガイド 4）
      try {
        const mailOutbox = createD1MailOutbox(db);
        const mailSender = createMailSender();
        const from = getMailFrom();

        const mailResult = await flushMailOutboxUseCase({
          mailOutbox,
          mailSender,
          from,
        });

        // 毎分動くので、送るものが無かった回は何も残さない。
        // stateUpdateFailed が 0 でない回は、同じメールが再送される可能性がある。
        if (mailResult.claimed > 0) {
          console.info("mail outbox flushed by cron:", mailResult);
        }
      } catch (error) {
        console.error("Scheduled mail outbox flush failed:", error);
      }

      // 1-2. カレンダー同期タスクの反映（ADR-008 実装方針）
      try {
        const calendarSyncTasks = createD1CalendarSyncTasks(db);
        const query = createD1CalendarSyncQuery(db);
        const calendarClient = createCalendarClient();

        const calendarResult = await processCalendarSyncTasksUseCase({
          calendarSyncTasks,
          query,
          calendarClient,
        });

        // 毎分動くので、処理するタスクが無かった回は何も残さない。
        if (calendarResult.claimed > 0) {
          console.info("calendar sync tasks processed by cron:", calendarResult);
        }
      } catch (error) {
        console.error("Scheduled calendar sync failed:", error);
      }

      return;
    }

    // 2. 日次突き合わせ（日本時間 4:00、COND-024 (4)）
    if (cron === CRON_DAILY_RECONCILE) {
      try {
        const query = createD1CalendarReconcileQuery(db);
        const calendarClient = createCalendarClient();

        const reconcileResult = await reconcileCalendarsUseCase({
          query,
          calendarClient,
          db,
        });

        console.info("daily calendar reconcile completed by cron:", reconcileResult);
      } catch (error) {
        console.error("Scheduled daily calendar reconcile failed:", error);
      }

      return;
    }

    // 未知の cron 式が来た場合は warn を残す
    console.warn("Unknown cron schedule triggered:", cron);
  },

  /**
   * 積んだ直後の即時配送（ADR-002 決定 1 / 決定 4 / 実装ガイド 4）。
   *
   * SMTP の失敗はここでは再試行せず（outbox の next_attempt_at に一本化する）、
   * 正常に処理が完了したら batch.ackAll() する。
   * ack しないのは、このハンドラ自体が例外等で落ちたときだけでよい。
   */
  async queue(batch, env, _ctx) {
    // 同じ ID が複数のメッセージに含まれうるので、flush に渡す前に重複を除く（ADR-002 決定 2.5）
    const rawIds = batch.messages.flatMap((message) => message.body.outboxIds);
    const uniqueIds = Array.from(new Set(rawIds));

    if (uniqueIds.length === 0) {
      batch.ackAll();
      return;
    }

    const db = createDb(env.DB);
    const mailOutbox = createD1MailOutbox(db);
    const mailSender = createMailSender();
    const from = getMailFrom();

    const result = await flushMailOutboxByIdsUseCase(
      {
        mailOutbox,
        mailSender,
        from,
      },
      { ids: uniqueIds },
    );

    if (result.claimed > 0) {
      console.info("mail outbox flushed by queue:", result);
    }

    batch.ackAll();
  },
} satisfies ExportedHandler<Env, MailQueueMessage>;
