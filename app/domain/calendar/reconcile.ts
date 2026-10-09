import type { CalendarEvent, CalendarSyncTaskDraft, ManagedCalendarEvent } from "./calendar-event";

/**
 * 期待される予定（expected）と実際のカレンダーの予定（actual）を比較し、
 * 発生している差異を解消するための同期タスク草稿（CalendarSyncTaskDraft）を導出する純粋関数。
 *
 * 【導出ルール（COND-024 (4)）】
 * 1. expected にあって actual に無い（登録漏れ）
 *    -> { reservationId, previousFacilityId: null }
 * 2. 両方にあってタイトル・開始日時・終了日時のいずれかが異なる（食い違い）
 *    -> { reservationId, previousFacilityId: null }
 * 3. actual にあって expected に無い（余分な予定）
 *    -> { reservationId: actual.reservationId, previousFacilityId: facilityId }
 *       ※予約が別の施設に移った・承認済みでなくなった・DB から削除された等のいずれの場合でも、
 *         毎分の処理が「この施設のカレンダーから予定を削除する」を実行できるように facilityId を設定する。
 *
 * 【設計上の考慮事項】
 * - 日時の比較は getTime() のミリ秒エポック値で行う（Google が返す dateTime はタイムゾーン表記が異なる場合があるため、文字列では比較しない）。
 * - 同一予約 ID に対する draft が重複して生成されないよう、Set で重複を排除する。
 */
export const diffCalendarEvents = (
  expected: readonly CalendarEvent[],
  actual: readonly ManagedCalendarEvent[],
  facilityId: string,
): readonly CalendarSyncTaskDraft[] => {
  const actualByReservationId = new Map<string, ManagedCalendarEvent>();
  for (const act of actual) {
    if (!actualByReservationId.has(act.reservationId)) {
      actualByReservationId.set(act.reservationId, act);
    }
  }

  const drafts: CalendarSyncTaskDraft[] = [];
  const processedReservationIds = new Set<string>();

  // 1. expected を走査し、登録漏れまたは内容の食い違いを検出
  for (const exp of expected) {
    if (processedReservationIds.has(exp.reservationId)) {
      continue;
    }
    processedReservationIds.add(exp.reservationId);

    const act = actualByReservationId.get(exp.reservationId);
    if (!act) {
      // 登録漏れ
      drafts.push({
        reservationId: exp.reservationId,
        previousFacilityId: null,
      });
      continue;
    }

    // 両方に存在する場合、タイトルまたは日時の食い違いを検証
    const isDifferent =
      exp.summary !== act.summary ||
      exp.startAt.getTime() !== act.startAt.getTime() ||
      exp.endAt.getTime() !== act.endAt.getTime();

    if (isDifferent) {
      // 内容の食い違い（タイトルや日時）
      drafts.push({
        reservationId: exp.reservationId,
        previousFacilityId: null,
      });
    }
  }

  // 2. actual を走査し、expected に無い余分な予定を検出
  for (const act of actual) {
    if (processedReservationIds.has(act.reservationId)) {
      continue;
    }
    processedReservationIds.add(act.reservationId);

    // 余分な予定（この施設のカレンダーから削除するため previousFacilityId に facilityId を設定）
    drafts.push({
      reservationId: act.reservationId,
      previousFacilityId: facilityId,
    });
  }

  return drafts;
};
