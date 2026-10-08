import { addDays, startOfTokyoDay } from "~/lib/date";
import { ReservationStatus } from "../reservation";

/**
 * あるべき予定（Google Calendar に登録・更新する内容）。
 *
 * 外部公開されるため、タイトルは施設名とし、開始・終了日時のみを持つ（COND-008 の 3 段目）。
 */
export interface CalendarEvent {
  readonly calendarId: string;
  readonly eventId: string;
  readonly summary: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /** 予約の ID。クライアントが目印（extendedProperties）を付与する際に参照する */
  readonly reservationId: string;
}

/**
 * カレンダーから読み取った、システムが登録した予定。
 *
 * extendedProperties.private にシステム登録の目印があるものだけを対象とする。
 */
export interface ManagedCalendarEvent {
  readonly eventId: string;
  readonly reservationId: string;
  readonly summary: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * 予約 ID から Google Calendar の予定 ID を決定論的に導出する純粋関数。
 *
 * Google Calendar の予定 ID は base32hex（小文字 a〜v と 0〜9）かつ長さ 5〜1024 文字である必要がある。
 * cuid2 は w〜z を含む可能性があるため、予約 ID を UTF-8 バイト列の小文字 16 進表記に変換し、
 * 先頭に "iclub"（すべて base32hex に含まれる文字）を付与する。
 */
export const toCalendarEventId = (reservationId: string): string => {
  const bytes = new TextEncoder().encode(reservationId);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `iclub${hex}`;
};

/** toDesiredCalendarEvent の引数 */
export interface DesiredCalendarEventState {
  readonly reservation: {
    readonly id: string;
    readonly status: ReservationStatus;
    readonly startAt: Date;
    readonly endAt: Date;
  };
  readonly facility: {
    readonly name: string;
    readonly googleCalendarId: string | null;
  } | null;
}

/**
 * 予約とその施設の今の状態から、あるべき予定を導出する純粋関数。
 *
 * 予約が承認済み（approved）で、かつ施設が存在し Google Calendar ID が設定されている場合のみ予定を返す（COND-024 (1)）。
 * それ以外（仮予約、終了・キャンセル、施設なし、施設にカレンダーID未設定）は null を返す。
 */
export const toDesiredCalendarEvent = (state: DesiredCalendarEventState): CalendarEvent | null => {
  if (state.reservation.status !== ReservationStatus.Approved) {
    return null;
  }

  if (!state.facility || !state.facility.googleCalendarId) {
    return null;
  }

  const trimmedCalendarId = state.facility.googleCalendarId.trim();
  if (trimmedCalendarId === "") {
    return null;
  }

  return {
    calendarId: trimmedCalendarId,
    eventId: toCalendarEventId(state.reservation.id),
    summary: state.facility.name,
    startAt: state.reservation.startAt,
    endAt: state.reservation.endAt,
    reservationId: state.reservation.id,
  };
};

/** 同期タスク作成の判定対象となる予約の情報 */
export interface CalendarSyncTarget {
  readonly status: ReservationStatus;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** 作成する同期タスクの草稿 */
export interface CalendarSyncTaskDraft {
  readonly reservationId: string;
  readonly previousFacilityId: string | null;
}

/**
 * 変更前後の予約情報から、同期タスクを積むべきかを判定して草稿を返す純粋関数。
 *
 * - 前後どちらも承認済みでなければ null（仮予約の取り消し・却下・仮予約同士の編集など）
 * - 前後とも承認済みで、施設・開始・終了日時がどれも変わっていなければ null（人数や備考のみの変更では EVT-011 を起こさない）
 * - それ以外はタスクを返す。施設が変更された場合は previousFacilityId に変更前の施設 ID を設定する（COND-024 (2)）。
 */
export const toCalendarSyncDraft = (
  reservationId: string,
  before: CalendarSyncTarget | null,
  after: CalendarSyncTarget,
): CalendarSyncTaskDraft | null => {
  const isBeforeApproved = before !== null && before.status === ReservationStatus.Approved;
  const isAfterApproved = after.status === ReservationStatus.Approved;

  // 前後どちらも承認済みでなければ同期対象外
  if (!isBeforeApproved && !isAfterApproved) {
    return null;
  }

  // 前後とも承認済みで、公開項目（施設・開始・終了日時）が変わっていなければ同期不要
  if (
    isBeforeApproved &&
    isAfterApproved &&
    before.facilityId === after.facilityId &&
    before.startAt.getTime() === after.startAt.getTime() &&
    before.endAt.getTime() === after.endAt.getTime()
  ) {
    return null;
  }

  // 施設が変わっていれば変更前の施設 ID を保持（変更前のカレンダーからも削除するため）
  const previousFacilityId =
    before !== null && before.facilityId !== after.facilityId ? before.facilityId : null;

  return {
    reservationId,
    previousFacilityId,
  };
};

/**
 * まとめて反映する範囲の始まりを計算する純粋関数。
 *
 * 処理する日の前日 0 時（日本時間）＝ startOfTokyoDay(addDays(now, -1))（COND-024 (5)）。
 */
export const calendarSyncRangeStart = (now: Date): Date => startOfTokyoDay(addDays(now, -1));

/** 施設のカレンダー同期再反映の判定対象となる施設情報 */
export interface FacilityCalendarResyncTarget {
  readonly name: string;
  readonly googleCalendarId: string | null;
}

/**
 * 施設の変更前後の情報から、その施設の承認済み予約を Google Calendar にまとめて反映すべきかを判定する純粋関数。
 *
 * - 名称が変わった → 真（EVT-011。予定のタイトルを新しい名称にする）
 * - Calendar ID が変わって変更後が null でない → 真（EVT-009。新しいカレンダーに登録する）
 * - Calendar ID を外した（変更後が null）だけ → 偽（元のカレンダーに残った予定は消さない。COND-024 (3)）
 * - どちらも変わらない（説明や写真だけの変更）→ 偽
 */
export const toFacilityCalendarResync = (
  before: FacilityCalendarResyncTarget,
  after: FacilityCalendarResyncTarget,
): boolean => {
  if (before.name !== after.name) {
    return true;
  }
  if (before.googleCalendarId !== after.googleCalendarId && after.googleCalendarId !== null) {
    return true;
  }
  return false;
};
