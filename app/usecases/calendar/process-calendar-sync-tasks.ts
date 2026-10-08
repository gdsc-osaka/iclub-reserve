import {
  isRetryableCalendarError,
  toCalendarEventId,
  toDesiredCalendarEvent,
  CALENDAR_SYNC_MAX_ATTEMPTS,
  CalendarErrorCode,
  type CalendarClient,
  type CalendarError,
  type CalendarSyncTask,
  type CalendarSyncTasks,
} from "~/domain/calendar";
import type {
  CalendarSyncQuery,
  CalendarSyncReservationState,
} from "~/query/calendar/calendar-sync-query";

/** 1 回の Cron で処理する同期タスクの上限（ADR-008 / 仕様 7） */
export const CALENDAR_SYNC_BATCH_SIZE = 5;

export interface ProcessCalendarSyncTasksDeps {
  readonly calendarSyncTasks: CalendarSyncTasks;
  readonly query: CalendarSyncQuery;
  readonly calendarClient: CalendarClient;
}

export interface ProcessCalendarSyncTasksResult {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly dead: number;
}

/** 予約ごとにまとめた同期対象グループ */
export interface ReservationSyncGroup {
  readonly reservationId: string;
  readonly taskIds: readonly number[];
  readonly previousFacilityIds: ReadonlySet<string>;
  readonly tasks: readonly CalendarSyncTask[];
}

/**
 * 取り出した同期タスクを予約 ID ごとにまとめる純粋関数。
 * 同じ予約に対する複数のタスクがあっても、同期処理は最新状態に合わせて 1 回だけ行う。
 */
export const toReservationSyncGroups = (
  tasks: readonly CalendarSyncTask[],
): readonly ReservationSyncGroup[] => {
  const map = new Map<
    string,
    {
      reservationId: string;
      taskIds: number[];
      previousFacilityIds: Set<string>;
      tasks: CalendarSyncTask[];
    }
  >();

  for (const task of tasks) {
    let group = map.get(task.reservationId);
    if (!group) {
      group = {
        reservationId: task.reservationId,
        taskIds: [],
        previousFacilityIds: new Set(),
        tasks: [],
      };
      map.set(task.reservationId, group);
    }
    group.taskIds.push(task.id);
    group.tasks.push(task);
    if (task.previousFacilityId !== null && task.previousFacilityId.trim() !== "") {
      group.previousFacilityIds.add(task.previousFacilityId.trim());
    }
  }

  return Array.from(map.values());
};

/**
 * 削除対象となる Google カレンダー ID の一覧を導出する純粋関数。
 *
 * - あるべき予定が無い場合は、現在の施設のカレンダーを削除対象に含める
 * - 変更前の施設のカレンダーを削除対象に含める
 * - あるべき予定のカレンダー（upsert 先）、null、空文字は除外する
 * - 重複は除外する
 */
export const toDeleteCalendarIds = (args: {
  readonly desiredCalendarId: string | null;
  readonly currentFacilityCalendarId: string | null;
  readonly previousFacilityCalendarIds: readonly (string | null)[];
}): readonly string[] => {
  const result = new Set<string>();

  // あるべき予定が無いときのみ、現在の施設のカレンダーから削除
  if (args.desiredCalendarId === null && args.currentFacilityCalendarId) {
    const trimmed = args.currentFacilityCalendarId.trim();
    if (trimmed !== "") {
      result.add(trimmed);
    }
  }

  // 変更前の施設のカレンダーから削除
  for (const prevCalId of args.previousFacilityCalendarIds) {
    if (prevCalId) {
      const trimmed = prevCalId.trim();
      if (trimmed !== "") {
        result.add(trimmed);
      }
    }
  }

  // あるべき予定のカレンダーは削除対象から除外（二重登録・誤削除の防止）
  if (args.desiredCalendarId) {
    result.delete(args.desiredCalendarId);
  }

  return Array.from(result);
};

/**
 * 同期待ちのタスクを calendar_sync_task から取り出して Google Calendar に反映するユースケース。
 *
 * 毎分の Cron から呼び出され、予約の最新状態に合わせてカレンダーの予定を upsert / delete する。
 * 1 つの予約の失敗で他の予約の処理は止めず、順次実行する。
 */
export const processCalendarSyncTasksUseCase = async (
  deps: ProcessCalendarSyncTasksDeps,
  options?: { readonly limit?: number; readonly now?: Date },
): Promise<ProcessCalendarSyncTasksResult> => {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? CALENDAR_SYNC_BATCH_SIZE;

  // 1. claimDue で期限の来たタスクを取り出す
  const claimResult = await deps.calendarSyncTasks.claimDue({ limit, now });
  if (claimResult.isErr()) {
    console.error("Failed to claim due calendar sync tasks:", claimResult.error);
    return { claimed: 0, completed: 0, failed: 0, retried: 0, dead: 0 };
  }

  const tasks = claimResult.value;
  if (tasks.length === 0) {
    return { claimed: 0, completed: 0, failed: 0, retried: 0, dead: 0 };
  }

  // 2. 予約 ID ごとにまとめる
  const groups = toReservationSyncGroups(tasks);

  // 3. 予約の今の状態と変更前の施設のカレンダー ID を一括取得
  const reservationIds = groups.map((g) => g.reservationId);
  const previousFacilityIds = Array.from(
    new Set(groups.flatMap((g) => Array.from(g.previousFacilityIds))),
  );

  const [reservationStatesResult, facilityCalendarIdsResult] = await Promise.all([
    deps.query.fetchReservationStates(reservationIds),
    deps.query.fetchFacilityCalendarIds(previousFacilityIds),
  ]);

  if (reservationStatesResult.isErr()) {
    console.error(
      "Failed to fetch reservation states for calendar sync:",
      reservationStatesResult.error,
    );
    return { claimed: tasks.length, completed: 0, failed: 0, retried: 0, dead: 0 };
  }

  if (facilityCalendarIdsResult.isErr()) {
    console.error(
      "Failed to fetch facility calendar IDs for calendar sync:",
      facilityCalendarIdsResult.error,
    );
    return { claimed: tasks.length, completed: 0, failed: 0, retried: 0, dead: 0 };
  }

  const reservationMap = new Map<string, CalendarSyncReservationState>(
    reservationStatesResult.value.map((r) => [r.id, r]),
  );
  const previousFacilityCalendarMap = new Map<string, string | null>(
    facilityCalendarIdsResult.value.map((f) => [f.id, f.googleCalendarId]),
  );

  let completed = 0;
  let failed = 0;
  let retried = 0;
  let dead = 0;

  // 4. 予約ごとに順次処理（1 件の失敗で他を巻き込まない）
  for (const group of groups) {
    try {
      const reservationState = reservationMap.get(group.reservationId);

      // あるべき予定を導出（DB に無い、または承認済みでない場合は null）
      const desiredEvent = reservationState
        ? toDesiredCalendarEvent({
            reservation: reservationState,
            facility: reservationState.facility,
          })
        : null;

      // 削除先カレンダー一覧を導出
      const deleteCalendarIds = toDeleteCalendarIds({
        desiredCalendarId: desiredEvent?.calendarId ?? null,
        currentFacilityCalendarId: reservationState?.facility?.googleCalendarId ?? null,
        previousFacilityCalendarIds: Array.from(group.previousFacilityIds).map(
          (prevId) => previousFacilityCalendarMap.get(prevId) ?? null,
        ),
      });

      let syncError: CalendarError | null = null;

      // (a) あるべき予定があれば upsertEvent
      if (desiredEvent) {
        const upsertResult = await deps.calendarClient.upsertEvent(desiredEvent);
        if (upsertResult.isErr()) {
          syncError = upsertResult.error;
        }
      }

      // (b) upsert が成功（または予定なし）かつ削除先があれば deleteEvent を順次実行
      if (!syncError) {
        for (const deleteCalId of deleteCalendarIds) {
          const deleteResult = await deps.calendarClient.deleteEvent(
            deleteCalId,
            toCalendarEventId(group.reservationId),
          );
          if (deleteResult.isErr()) {
            syncError = deleteResult.error;
            break;
          }
        }
      }

      // (c) 結果の後始末
      if (syncError) {
        console.error(`Calendar sync failed for reservation ${group.reservationId}:`, syncError);
        const failResult = await deps.calendarSyncTasks.fail({
          ids: group.taskIds,
          error: syncError,
          now,
        });
        if (failResult.isErr()) {
          console.error("Failed to mark calendar sync tasks as failed:", failResult.error);
        }

        failed += group.tasks.length;
        const isRetryable = isRetryableCalendarError(syncError);
        for (const task of group.tasks) {
          if (isRetryable && task.attemptCount < CALENDAR_SYNC_MAX_ATTEMPTS) {
            retried++;
          } else {
            dead++;
          }
        }
      } else {
        const completeResult = await deps.calendarSyncTasks.complete(group.taskIds);
        if (completeResult.isErr()) {
          console.error("Failed to complete calendar sync tasks:", completeResult.error);
        } else {
          completed += group.tasks.length;
        }
      }
    } catch (unexpectedError) {
      console.error(
        `Unexpected error during calendar sync for reservation ${group.reservationId}:`,
        unexpectedError,
      );
      const calendarError: CalendarError = {
        code: CalendarErrorCode.Unavailable,
        message: "カレンダー同期中に予期しない例外が発生しました。",
        cause: unexpectedError,
      };
      await deps.calendarSyncTasks.fail({
        ids: group.taskIds,
        error: calendarError,
        now,
      });

      failed += group.tasks.length;
      for (const task of group.tasks) {
        if (task.attemptCount < CALENDAR_SYNC_MAX_ATTEMPTS) {
          retried++;
        } else {
          dead++;
        }
      }
    }
  }

  return { claimed: tasks.length, completed, failed, retried, dead };
};
