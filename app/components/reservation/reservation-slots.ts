import { RESERVATION_STEP_MINUTES, ReservationStatus } from "~/domain/reservation";
import { atTokyoMinutes, startOfTokyoDay } from "~/lib/date";
import type { ReservationFormReservation } from "~/query/reservation/reservation-form";

import { CLOSE_MINUTES, OPEN_MINUTES } from "./availability-week";

/**
 * 予約申請フォーム（SCR-002）のタイムラインで使う計算。
 *
 * 画面の都合しか持たない計算なので、React から切り離して純粋な関数にしてある。
 * 空き状況カレンダー（SCR-001）が 1 時間単位で枠を並べるのに対し、
 * こちらは 30 分単位（`RESERVATION_STEP_MINUTES`）で並べる。
 */

/** 選べる開始時刻の一覧（0 時から何分）。9:00〜20:30 */
export const startSlotMinutes: readonly number[] = Array.from(
  { length: (CLOSE_MINUTES - OPEN_MINUTES) / RESERVATION_STEP_MINUTES },
  (_, index) => OPEN_MINUTES + index * RESERVATION_STEP_MINUTES,
);

/**
 * 選べる終了時刻の一覧（0 時から何分）。9:30〜21:00
 *
 * 開始時刻の一覧とは 1 つずれる。9:00 に終わる予約も、
 * 21:00 に始まる予約も作れないため。
 */
export const endSlotMinutes: readonly number[] = startSlotMinutes.map(
  (minutes) => minutes + RESERVATION_STEP_MINUTES,
);

/** 選んでいる時間帯。その日の 0 時から何分かで表す。 */
export interface SlotRange {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** タイムラインに描く予約 1 件。位置はその日の 0 時から何分かで表す。 */
export interface TimelineReservation {
  readonly reservation: ReservationFormReservation;
  /** 表示範囲に収めた開始位置（分）。9:00 より前から続く予約は 9:00 に切り詰める */
  readonly startMinutes: number;
  /** 表示範囲に収めた終了位置（分） */
  readonly endMinutes: number;
}

/** ある日時が、基準の日の 0 時から何分後かを返す（日をまたぐと 1440 を超える） */
const minutesFromDayStart = (date: Date, dayStart: Date): number =>
  (date.getTime() - dayStart.getTime()) / (60 * 1000);

/**
 * 1 日・1 施設分の予約を、時間軸に収まる形で取り出す。
 *
 * 予約は日をまたぐことも、利用可能時間の外にはみ出すこともありうるので、
 * 表示できる範囲へ切り詰める。切り詰めるのは帯の位置だけで、
 * 画面に出す時刻は予約そのものの値を使うこと。
 * 切り詰めた時刻を出すと、9 時前から続いている予約が 9 時開始に見えてしまう。
 */
export const toTimelineReservations = (
  reservations: readonly ReservationFormReservation[],
  facilityId: string,
  day: Date,
): readonly TimelineReservation[] => {
  const dayStart = startOfTokyoDay(day);
  const dayOpen = atTokyoMinutes(day, OPEN_MINUTES);
  const dayClose = atTokyoMinutes(day, CLOSE_MINUTES);

  return reservations
    .filter(
      (reservation) =>
        reservation.facilityId === facilityId &&
        reservation.startAt < dayClose &&
        reservation.endAt > dayOpen,
    )
    .map((reservation) => ({
      reservation,
      startMinutes: Math.max(OPEN_MINUTES, minutesFromDayStart(reservation.startAt, dayStart)),
      endMinutes: Math.min(CLOSE_MINUTES, minutesFromDayStart(reservation.endAt, dayStart)),
    }));
};

/**
 * 申請できない枠（承認済みの予約と重なる枠）を返す（COND-001）。
 *
 * 数えるのは承認済みの予約だけ。仮予約どうしは重なってよいので、
 * ここで塞いでしまうと「同じ時間帯に複数の団体が申請して事務局が選ぶ」
 * という使い方ができなくなる。
 */
export const toBlockedSlots = (items: readonly TimelineReservation[]): ReadonlySet<number> => {
  const blocked = new Set<number>();

  for (const item of items) {
    if (item.reservation.status !== ReservationStatus.Approved) continue;

    for (const slot of startSlotMinutes) {
      if (item.startMinutes < slot + RESERVATION_STEP_MINUTES && item.endMinutes > slot) {
        blocked.add(slot);
      }
    }
  }

  return blocked;
};

/**
 * すでに過ぎてしまった枠を返す。
 *
 * 送信すればドメイン（`validateReservationPeriod`）が弾くが、
 * 押せる状態のまま残すと、送信して初めて選べないと分かることになる。
 * 今日より前の日はすべての枠がここに入るので、日付ごとの分岐は要らない。
 */
export const toPastSlots = (day: Date, now: Date): ReadonlySet<number> => {
  const past = new Set<number>();

  for (const slot of startSlotMinutes) {
    if (atTokyoMinutes(day, slot) < now) past.add(slot);
  }

  return past;
};

/**
 * 選んだ時間帯と重なる予約を返す。
 *
 * 承認済みが混ざっていれば申請できず（COND-001）、仮予約だけなら申請できる。
 * どちらなのかは呼び出し側がステータスを見て決める。
 */
export const findOverlapping = (
  items: readonly TimelineReservation[],
  range: SlotRange,
): readonly TimelineReservation[] =>
  items.filter(
    (item) => item.startMinutes < range.endMinutes && item.endMinutes > range.startMinutes,
  );

/**
 * タイムラインの枠を押したときに、新しく選ばれる時間帯を返す。
 *
 * - まだ何も選んでいない → 押した枠だけ（30 分）
 * - 選んでいる開始時刻より後ろを押した → そこまで伸ばす
 * - 選んでいる開始時刻と同じか前を押した → その枠から選び直す
 *
 * 「1 回目で開始、2 回目で終了」と段階を持たせていないのは、
 * 段階を画面に出さないと、いま何を選んでいるのかが利用者に分からないため。
 * この決め方なら、押した場所と結果が常に 1 対 1 で対応する。
 *
 * 伸ばす途中に承認済みの予約があるときは、手前で止めずに、
 * 押した枠から選び直す（COND-001）。手前で止めると、押した枠より前に
 * 承認済みの予約がある限り何度押しても選択が動かず、
 * 押しても反応しない画面に見えてしまう。
 */
export const selectSlot = (
  current: SlotRange | null,
  slotStartMinutes: number,
  blockedSlots: ReadonlySet<number>,
): SlotRange => {
  const single = {
    startMinutes: slotStartMinutes,
    endMinutes: slotStartMinutes + RESERVATION_STEP_MINUTES,
  };

  if (current === null || slotStartMinutes <= current.startMinutes) return single;

  for (
    let minutes = current.startMinutes + RESERVATION_STEP_MINUTES;
    minutes <= slotStartMinutes;
    minutes += RESERVATION_STEP_MINUTES
  ) {
    if (blockedSlots.has(minutes)) return single;
  }

  return {
    startMinutes: current.startMinutes,
    endMinutes: slotStartMinutes + RESERVATION_STEP_MINUTES,
  };
};
