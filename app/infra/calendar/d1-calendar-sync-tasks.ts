import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";

import { calendarSyncTaskTable } from "~/db/schema";
import {
  CALENDAR_SYNC_MAX_ATTEMPTS,
  calculateCalendarSyncBackoffDelayMs,
  CalendarSyncStatus,
  CalendarSyncTaskErrorCode,
  isRetryableCalendarError,
  type CalendarError,
  type CalendarSyncTask,
  type CalendarSyncTaskError,
  type CalendarSyncTasks,
} from "~/domain/calendar";

import type { Database } from "../db";

/** 処理中のまま放置されたとみなすまでの時間（5分）。Worker が途中で落ちた行を救う（ADR-008） */
export const CALENDAR_SYNC_STUCK_AFTER_MS = 5 * 60 * 1000;

const toCalendarSyncTaskError = (cause: unknown): CalendarSyncTaskError => ({
  code: CalendarSyncTaskErrorCode.DatabaseError,
  message: "カレンダー同期タスクの操作に失敗しました。",
  cause,
});

const formatCalendarError = (error: CalendarError): string => {
  const cause = error.cause ? String(error.cause) : "";
  return cause ? `${error.code}: ${cause}` : error.code;
};

const toCalendarSyncTask = (row: typeof calendarSyncTaskTable.$inferSelect): CalendarSyncTask => ({
  id: row.id,
  reservationId: row.reservationId,
  previousFacilityId: row.previousFacilityId,
  attemptCount: row.attemptCount,
});

/**
 * 処理可能な状態（pending かつ時刻到来、または processing かつ放置）を判定する述語。
 */
const buildDuePredicate = (now: Date) =>
  or(
    // 処理待ちで実行時刻が到来したもの
    and(
      eq(calendarSyncTaskTable.status, CalendarSyncStatus.Pending),
      lte(calendarSyncTaskTable.nextAttemptAt, now),
    ),
    // 処理中のまま放置されたもの（Worker の異常終了などで回収が必要な行）
    and(
      eq(calendarSyncTaskTable.status, CalendarSyncStatus.Processing),
      lte(calendarSyncTaskTable.updatedAt, new Date(now.getTime() - CALENDAR_SYNC_STUCK_AFTER_MS)),
    ),
  );

/**
 * Cloudflare D1 (Drizzle) を使った CalendarSyncTasks の実装。
 */
export const createD1CalendarSyncTasks = (db: Database): CalendarSyncTasks => ({
  claimDue: ({ limit, now }) =>
    ResultAsync.fromPromise(
      db
        .update(calendarSyncTaskTable)
        .set({
          status: CalendarSyncStatus.Processing,
          updatedAt: now,
        })
        .where(
          inArray(
            calendarSyncTaskTable.id,
            db
              .select({ id: calendarSyncTaskTable.id })
              .from(calendarSyncTaskTable)
              .where(buildDuePredicate(now))
              .orderBy(asc(calendarSyncTaskTable.nextAttemptAt), asc(calendarSyncTaskTable.id))
              .limit(limit),
          ),
        )
        .returning(),
      toCalendarSyncTaskError,
    ).map((rows) => rows.map(toCalendarSyncTask)),

  complete: (ids) => {
    if (ids.length === 0) {
      return okAsync(undefined);
    }

    return ResultAsync.fromPromise(
      db.delete(calendarSyncTaskTable).where(inArray(calendarSyncTaskTable.id, [...ids])),
      toCalendarSyncTaskError,
    ).map(() => undefined);
  },

  fail: ({ ids, error, now }) => {
    if (ids.length === 0) {
      return okAsync(undefined);
    }

    const isRetryable = isRetryableCalendarError(error);
    const formattedError = formatCalendarError(error);

    // 再試行不可のエラーは即座に dead（まとめて 1 クエリで更新）
    if (!isRetryable) {
      return ResultAsync.fromPromise(
        db
          .update(calendarSyncTaskTable)
          .set({
            status: CalendarSyncStatus.Dead,
            lastError: formattedError,
            updatedAt: now,
          })
          .where(inArray(calendarSyncTaskTable.id, [...ids])),
        toCalendarSyncTaskError,
      ).map(() => undefined);
    }

    // 再試行可能のエラーは attemptCount を増やして backoff（SELECT 1回 + batch 1回で更新）
    return ResultAsync.fromPromise(
      db
        .select({
          id: calendarSyncTaskTable.id,
          attemptCount: calendarSyncTaskTable.attemptCount,
        })
        .from(calendarSyncTaskTable)
        .where(inArray(calendarSyncTaskTable.id, [...ids])),
      toCalendarSyncTaskError,
    ).andThen((rows) => {
      if (rows.length === 0) {
        return okAsync(undefined);
      }

      const statements = rows.map((row) => {
        const nextAttemptCount = row.attemptCount + 1;
        // 6回目（attemptCount が 5 を超えたとき）は dead
        const isDead = nextAttemptCount > CALENDAR_SYNC_MAX_ATTEMPTS;
        const status = isDead ? CalendarSyncStatus.Dead : CalendarSyncStatus.Pending;
        const delayMs = calculateCalendarSyncBackoffDelayMs(row.attemptCount);
        const nextAttemptAt = new Date(now.getTime() + delayMs);

        return db
          .update(calendarSyncTaskTable)
          .set({
            status,
            attemptCount: nextAttemptCount,
            nextAttemptAt,
            lastError: formattedError,
            updatedAt: now,
          })
          .where(eq(calendarSyncTaskTable.id, row.id));
      });

      const [first, ...rest] = statements;
      if (first === undefined) {
        return okAsync(undefined);
      }

      return ResultAsync.fromPromise(db.batch([first, ...rest]), toCalendarSyncTaskError).map(
        () => undefined,
      );
    });
  },
});
