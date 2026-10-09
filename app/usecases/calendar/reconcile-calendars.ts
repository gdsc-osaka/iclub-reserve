import type { BatchItem } from "drizzle-orm/batch";
import {
  calendarSyncRangeStart,
  CalendarErrorCode,
  diffCalendarEvents,
  toDesiredCalendarEvent,
  type CalendarClient,
  type CalendarError,
  type CalendarEvent,
  type CalendarSyncTaskDraft,
} from "~/domain/calendar";
import { ReservationStatus } from "~/domain/reservation";
import { reconcileCalendarSyncTaskInserts } from "~/infra/calendar/calendar-sync-task-writes";
import type { Database } from "~/infra/db";
import type {
  CalendarReconcileFacility,
  CalendarReconcileQuery,
  CalendarReconcileReservation,
} from "~/query/calendar/calendar-reconcile-query";

export interface ReconcileCalendarsDeps {
  readonly query: CalendarReconcileQuery;
  readonly calendarClient: CalendarClient;
  readonly db: Database;
}

export interface ReconcileCalendarsResult {
  readonly facilityCount: number;
  readonly unreadableFacilityCount: number;
  readonly taskCount: number;
}

/**
 * 施設の承認済み予約情報から、あるべきカレンダー予定の一覧を組み立てる純粋関数。
 */
export const toExpectedCalendarEvents = (
  reservations: readonly CalendarReconcileReservation[],
  facility: CalendarReconcileFacility,
): readonly CalendarEvent[] => {
  const events: CalendarEvent[] = [];
  for (const reservation of reservations) {
    const event = toDesiredCalendarEvent({
      reservation: {
        id: reservation.id,
        status: ReservationStatus.Approved,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      },
      facility: {
        name: facility.name,
        googleCalendarId: facility.googleCalendarId,
      },
    });
    if (event) {
      events.push(event);
    }
  }
  return events;
};

/**
 * 同期タスク草稿の配列から同一予約 ID の重複を取り除く純粋関数。
 */
export const toUniqueCalendarSyncTaskDrafts = (
  drafts: readonly CalendarSyncTaskDraft[],
): readonly CalendarSyncTaskDraft[] => {
  const seen = new Set<string>();
  const unique: CalendarSyncTaskDraft[] = [];
  for (const draft of drafts) {
    if (!seen.has(draft.reservationId)) {
      seen.add(draft.reservationId);
      unique.push(draft);
    }
  }
  return unique;
};

/**
 * 施設カレンダーの読み込み失敗ログを出力する補助関数。
 * 見つからない・権限が無いは設定誤りなので warn（設定確認を促す）、一時的エラーは明日の再試行を添える。
 */
const logUnreadableFacility = (facility: CalendarReconcileFacility, error: CalendarError): void => {
  if (error.code === CalendarErrorCode.NotFound || error.code === CalendarErrorCode.Forbidden) {
    console.warn(
      `施設 ${facility.id} (${facility.name}) のカレンダー（${facility.googleCalendarId}）にアクセスできませんでした（設定誤りの可能性: ${error.code}）。権限やカレンダーIDの設定を確認してください。`,
      error,
    );
  } else {
    console.warn(
      `施設 ${facility.id} (${facility.name}) のカレンダー（${facility.googleCalendarId}）の読み込みに一時的に失敗しました（${error.code}）。明日の日次突き合わせで再試行されます。`,
      error,
    );
  }
};

/**
 * 予約と Google Calendar の予定を 1 日 1 回突き合わせるユースケース（COND-024 (4)）。
 *
 * 【処理の流れ】
 * 1. Google Calendar ID が設定されている施設と、その施設の承認済み予約（end_at >= rangeStart）を取得。
 * 2. 施設ごとに、あるべき予定を導出し、Google Calendar から現在の管理対象予定を取得して diff を計算。
 * 3. ある施設の読み込みに失敗しても中断せず、他の施設の処理を継続する。
 * 4. 差異が検出されたすべての草稿を calendar_sync_task に db.batch() で一括投入する。
 *    （実際の反映は毎分の cron に任せ、修復手順を二重に持たない）。
 */
export const reconcileCalendarsUseCase = async (
  deps: ReconcileCalendarsDeps,
  options?: { readonly now?: Date },
): Promise<ReconcileCalendarsResult> => {
  const now = options?.now ?? new Date();
  const rangeStart = calendarSyncRangeStart(now);

  // 1. Google Calendar ID のある施設の一覧を取得（有効・無効は問わない）
  const facilitiesResult = await deps.query.fetchTargetFacilities();
  if (facilitiesResult.isErr()) {
    console.error("日次突き合わせ用施設の取得に失敗しました:", facilitiesResult.error);
    return { facilityCount: 0, unreadableFacilityCount: 0, taskCount: 0 };
  }

  const facilities = facilitiesResult.value;
  if (facilities.length === 0) {
    return { facilityCount: 0, unreadableFacilityCount: 0, taskCount: 0 };
  }

  const facilityIds = facilities.map((f) => f.id);

  // 2. それらの施設の承認済み予約を 1 回の問い合わせで一括取得
  // 境界の扱い: DB 側は end_at >= rangeStart、Google 側は timeMin=endAfter (end > rangeStart) となるが、
  // 施設の利用時間は 9〜21 時のため 0 時ちょうどに終わる予約は存在せず、両者で対象範囲に食い違いは生じない。
  const reservationsResult = await deps.query.fetchApprovedReservations(facilityIds, rangeStart);
  if (reservationsResult.isErr()) {
    console.error("日次突き合わせ用予約の取得に失敗しました:", reservationsResult.error);
    return { facilityCount: facilities.length, unreadableFacilityCount: 0, taskCount: 0 };
  }

  const reservations = reservationsResult.value;

  // 予約を施設 ID ごとにまとめる
  const reservationsByFacilityId = new Map<string, CalendarReconcileReservation[]>();
  for (const res of reservations) {
    let list = reservationsByFacilityId.get(res.facilityId);
    if (!list) {
      list = [];
      reservationsByFacilityId.set(res.facilityId, list);
    }
    list.push(res);
  }

  const allDrafts: CalendarSyncTaskDraft[] = [];
  let unreadableFacilityCount = 0;

  // 3. 施設ごとに予定を突き合わせる
  for (const facility of facilities) {
    const facilityReservations = reservationsByFacilityId.get(facility.id) ?? [];
    const expected = toExpectedCalendarEvents(facilityReservations, facility);

    const actualResult = await deps.calendarClient.listManagedEvents(
      facility.googleCalendarId,
      rangeStart,
    );

    if (actualResult.isErr()) {
      unreadableFacilityCount++;
      logUnreadableFacility(facility, actualResult.error);
      continue;
    }

    const actual = actualResult.value;
    const drafts = diffCalendarEvents(expected, actual, facility.id);
    allDrafts.push(...drafts);
  }

  // 4. 重複する予約 ID の draft を集約
  const uniqueDrafts = toUniqueCalendarSyncTaskDrafts(allDrafts);

  // 5. calendar_sync_task に一括投入
  if (uniqueDrafts.length > 0) {
    try {
      const statements = reconcileCalendarSyncTaskInserts(deps.db, uniqueDrafts, now);
      if (statements.length > 0) {
        await deps.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
      }
    } catch (dbError) {
      console.error("日次突き合わせタスクの DB 投入に失敗しました:", dbError);
      return {
        facilityCount: facilities.length,
        unreadableFacilityCount,
        taskCount: 0,
      };
    }
  }

  return {
    facilityCount: facilities.length,
    unreadableFacilityCount,
    taskCount: uniqueDrafts.length,
  };
};
