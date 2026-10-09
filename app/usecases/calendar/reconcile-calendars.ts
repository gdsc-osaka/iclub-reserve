import {
  calendarSyncRangeStart,
  diffCalendarEvents,
  isRetryableCalendarError,
  toDesiredCalendarEvent,
  type CalendarClient,
  type CalendarError,
  type CalendarEvent,
  type CalendarSyncTaskDraft,
  type CalendarSyncTasks,
} from "~/domain/calendar";
import { ReservationStatus } from "~/domain/reservation";
import type {
  CalendarReconcileFacility,
  CalendarReconcileQuery,
  CalendarReconcileReservation,
} from "~/query/calendar/calendar-reconcile-query";

export interface ReconcileCalendarsDeps {
  readonly query: CalendarReconcileQuery;
  readonly calendarClient: CalendarClient;
  readonly calendarSyncTasks: CalendarSyncTasks;
}

export interface ReconcileCalendarsResult {
  readonly facilityCount: number;
  readonly unreadableFacilityCount: number;
  readonly taskCount: number;
}

/**
 * 施設の承認済み予約情報から、あるべきカレンダー予定の一覧を組み立てる純粋関数。
 *
 * クエリが承認済みの予約だけを返すので、状態は承認済みとして渡す。
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
 * 施設のカレンダーを読めなかったことをログに残す。
 *
 * 一時的な失敗（再試行できるエラー）は翌日の突き合わせで読み直されるので warn にとどめる。
 * それ以外（カレンダーが見つからない・権限が無い・認証の失敗など）は設定の誤りで、
 * 人が直さない限り毎日失敗し続けるので error にする。
 * Calendar ID と施設名は事務局が入力した値なのでログに埋め込まず、施設 ID で示す（ADR-004）。
 */
const logUnreadableFacility = (facilityId: string, error: CalendarError): void => {
  if (isRetryableCalendarError(error)) {
    console.warn(
      `施設 ${facilityId} のカレンダーを一時的に読めませんでした（${error.code}）。翌日の突き合わせで読み直します。`,
      error,
    );
    return;
  }
  console.error(
    `施設 ${facilityId} のカレンダーを読めませんでした（${error.code}）。施設の Calendar ID と、カレンダーの共有の設定を確かめてください。`,
    error,
  );
};

/**
 * 予約と Google Calendar の予定を 1 日 1 回突き合わせるユースケース（COND-024 (4)）。
 *
 * 【処理の流れ】
 * 1. Google Calendar ID が設定されている施設と、その施設の承認済み予約（end_at >= rangeStart）を取得。
 * 2. 施設ごとに、あるべき予定を導出し、Google Calendar から現在の管理対象予定を取得して diff を計算。
 *    ある施設の読み込みに失敗しても中断せず、他の施設の処理を継続する。
 * 3. 差異が検出されたすべての draft を calendar_sync_task に積む。
 *    実際の反映は毎分の cron に任せ、直し方を 2 か所に持たない（ADR-008）。
 */
export const reconcileCalendarsUseCase = async (
  deps: ReconcileCalendarsDeps,
  options?: { readonly now?: Date },
): Promise<ReconcileCalendarsResult> => {
  const now = options?.now ?? new Date();
  const rangeStart = calendarSyncRangeStart(now);

  // 1. Google Calendar ID のある施設の一覧と、その施設の承認済み予約を読む
  const facilitiesResult = await deps.query.fetchTargetFacilities();
  if (facilitiesResult.isErr()) {
    console.error("日次突き合わせ用施設の取得に失敗しました:", facilitiesResult.error);
    return { facilityCount: 0, unreadableFacilityCount: 0, taskCount: 0 };
  }

  const facilities = facilitiesResult.value;
  if (facilities.length === 0) {
    return { facilityCount: 0, unreadableFacilityCount: 0, taskCount: 0 };
  }

  // 境界の扱い: DB 側は end_at >= rangeStart、Google 側は timeMin=endAfter (end > rangeStart) となるが、
  // 施設の利用時間は 9〜21 時のため 0 時ちょうどに終わる予約は存在せず、両者で対象範囲に食い違いは生じない。
  const reservationsResult = await deps.query.fetchApprovedReservations(
    facilities.map((f) => f.id),
    rangeStart,
  );
  if (reservationsResult.isErr()) {
    console.error("日次突き合わせ用予約の取得に失敗しました:", reservationsResult.error);
    return { facilityCount: facilities.length, unreadableFacilityCount: 0, taskCount: 0 };
  }

  const reservationsByFacilityId = new Map<string, CalendarReconcileReservation[]>();
  for (const reservation of reservationsResult.value) {
    const list = reservationsByFacilityId.get(reservation.facilityId) ?? [];
    list.push(reservation);
    reservationsByFacilityId.set(reservation.facilityId, list);
  }

  // 2. 施設ごとに予定を突き合わせる。Google への呼び出しは並べずに順に行う（ADR-008）
  // 別の施設に移った予約は「移った先で登録漏れ」と「元の施設に残った余分な予定」の 2 つの draft になる。
  // 毎分の処理は同じ予約の行をまとめ、previousFacilityId もすべて合わせて使うので、どちらも捨てずに積む。
  const drafts: CalendarSyncTaskDraft[] = [];
  let unreadableFacilityCount = 0;

  for (const facility of facilities) {
    const expected = toExpectedCalendarEvents(
      reservationsByFacilityId.get(facility.id) ?? [],
      facility,
    );

    const actualResult = await deps.calendarClient.listManagedEvents(
      facility.googleCalendarId,
      rangeStart,
    );
    if (actualResult.isErr()) {
      unreadableFacilityCount++;
      logUnreadableFacility(facility.id, actualResult.error);
      continue;
    }

    drafts.push(...diffCalendarEvents(expected, actualResult.value, facility.id));
  }

  // 3. 見つけた差分を同期タスクとして積む
  if (drafts.length > 0) {
    const enqueueResult = await deps.calendarSyncTasks.enqueue({ drafts, now });
    if (enqueueResult.isErr()) {
      console.error("日次突き合わせのタスクを積めませんでした:", enqueueResult.error);
      return { facilityCount: facilities.length, unreadableFacilityCount, taskCount: 0 };
    }
  }

  return {
    facilityCount: facilities.length,
    unreadableFacilityCount,
    taskCount: drafts.length,
  };
};
