import { createRequestHandler } from "react-router";
import { createCalendarClient } from "~/infra/calendar/calendar-client-factory.server";
import { createD1CalendarSyncQuery } from "~/infra/calendar/d1-calendar-sync-query";
import { createD1CalendarSyncTasks } from "~/infra/calendar/d1-calendar-sync-tasks";
import { createDb } from "~/infra/db";
import { createD1MailOutbox } from "~/infra/mail/d1-mail-outbox";
import type { MailQueueMessage } from "~/infra/mail/mail-queue.server";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import { processCalendarSyncTasksUseCase } from "~/usecases/calendar/process-calendar-sync-tasks";
import {
  flushMailOutboxByIdsUseCase,
  flushMailOutboxUseCase,
} from "~/usecases/mail/flush-mail-outbox.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  /**
   * 毎分の定期処理。
   * 1. メールの取りこぼし回収（ADR-002 実装ガイド 4）
   * 2. カレンダー同期タスクの反映（ADR-008 実装方針）
   *
   * 片方が例外を投げてももう片方を巻き込まないよう、それぞれ独立して実行する。
   */
  async scheduled(_controller, env, _ctx) {
    const db = createDb(env.DB);

    // 1. メールの回収
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

    // 2. カレンダー同期タスクの反映
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
