import { CLOSE_MINUTES, OPEN_MINUTES } from "~/components/reservation/availability-week";
import { RESERVATION_STEP_MINUTES, ReservationStatus } from "~/domain/reservation";
import { atTokyoMinutes, startOfTokyoDay, toTokyoTimeKey } from "~/lib/date";
import type { ReservationFormReservation } from "~/query/reservation/reservation-form";

/**
 * 予約の日時を選ぶタイムラインで使う計算。
 *
 * 仮予約の申請（SCR-002）で使っており、予約の編集（UC-017 / UC-005）でも同じものを使う想定。
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

/** `toBlockedSlots` が読む項目だけの形。申請フォームの帯と空き状況カレンダーの帯の両方を渡せる */
export interface BlockedSlotItem {
  readonly reservation: { readonly status: ReservationStatus };
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/**
 * 申請できない枠（承認済みの予約と重なる枠）を返す（COND-001）。
 *
 * 数えるのは承認済みの予約だけ。仮予約どうしは重なってよいので、
 * ここで塞いでしまうと「同じ時間帯に複数の団体が申請して事務局が選ぶ」
 * という使い方ができなくなる。
 */
export const toBlockedSlots = (items: readonly BlockedSlotItem[]): ReadonlySet<number> => {
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
 * 空いている枠を押したときの、仮の枠の初期の長さ（ADR-014 決定 6）。
 *
 * 開始から 1 時間を取れれば 1 時間、取れなければ 30 分を返す。
 * 1 時間取れないのは、30 分後の枠が承認済みの予約で塞がれている（blockedSlots）か、
 * 1 時間後が閉館時刻（CLOSE_MINUTES、21:00）を超えるとき。
 *
 * 開始の枠そのものが押せるか（承認済みと重ならない・過ぎていない）は、呼び出し側が先に確かめる。
 */
export const toDefaultRange = (
  startMinutes: number,
  blockedSlots: ReadonlySet<number>,
): SlotRange => {
  const oneHourEnd = startMinutes + RESERVATION_STEP_MINUTES * 2;
  const nextSlot = startMinutes + RESERVATION_STEP_MINUTES;
  const canTakeOneHour = oneHourEnd <= CLOSE_MINUTES && !blockedSlots.has(nextSlot);

  return { startMinutes, endMinutes: canTakeOneHour ? oneHourEnd : nextSlot };
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

/** `findOverlapping` が受け取れる、開始と終了を持つ要素 */
export interface SpanItem {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/**
 * 選んだ時間帯と重なる予約を返す。
 *
 * 承認済みが混ざっていれば申請できず（COND-001）、仮予約だけなら申請できる。
 * どちらなのかは呼び出し側がステータスを見て決める。
 */
export const findOverlapping = <T extends SpanItem>(
  items: readonly T[],
  range: SlotRange,
): readonly T[] =>
  items.filter(
    (item) => item.startMinutes < range.endMinutes && item.endMinutes > range.startMinutes,
  );

/** `toConflicts` が受け取れる、予約ステータスを持つ要素 */
export interface ConflictItem extends SpanItem {
  readonly reservation: {
    readonly status: ReservationStatus;
  };
}

/** 時間帯と重なる予約を、承認済みと仮予約に分けたもの */
export interface Conflicts<T extends ConflictItem> {
  readonly approvedConflicts: readonly T[];
  readonly provisionalConflicts: readonly T[];
}

/**
 * 時間帯と重なる予約を、承認済み（approvedConflicts）と仮予約（provisionalConflicts）に分けて返す。
 */
export const toConflicts = <T extends ConflictItem>(
  items: readonly T[],
  range: SlotRange,
): Conflicts<T> => {
  const overlapping = findOverlapping(items, range);
  return {
    approvedConflicts: overlapping.filter(
      (item) => item.reservation.status === ReservationStatus.Approved,
    ),
    provisionalConflicts: overlapping.filter(
      (item) => item.reservation.status === ReservationStatus.Provisional,
    ),
  };
};

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

/**
 * タイムラインをなぞって選んだときの、いまの時間帯を返す。
 *
 * `anchorSlot` は押し始めた枠、`slotStartMinutes` はいま指している枠。
 * 上へなぞっても下へなぞっても選べるように、どちらが前かはここで決める。
 *
 * なぞった先に選べない枠（承認済みの予約と重なる枠・過ぎた枠）があるときは、
 * その**手前で止める**。{@link selectSlot} が押した枠から選び直すのとは逆の扱いにしている。
 * あちらは離れた枠を 1 回押す操作なので、途中に予約があると
 * 何度押しても選択が動かない画面に見えてしまうが、
 * なぞる操作では指の動きに合わせて帯が伸び続けるので、
 * 止まった位置がそのまま「ここまでしか取れない」と読める。
 */
export const dragRange = (
  anchorSlot: number,
  slotStartMinutes: number,
  unselectableSlots: ReadonlySet<number>,
): SlotRange => {
  const step =
    slotStartMinutes >= anchorSlot ? RESERVATION_STEP_MINUTES : -RESERVATION_STEP_MINUTES;

  // 押し始めた枠から 1 枠ずつ進み、選べない枠に当たったところで止める
  let reached = anchorSlot;

  for (
    let minutes = anchorSlot + step;
    step > 0 ? minutes <= slotStartMinutes : minutes >= slotStartMinutes;
    minutes += step
  ) {
    if (unselectableSlots.has(minutes)) break;
    reached = minutes;
  }

  return {
    startMinutes: Math.min(anchorSlot, reached),
    endMinutes: Math.max(anchorSlot, reached) + RESERVATION_STEP_MINUTES,
  };
};

/**
 * 選んだ長さを「2 時間」「1 時間 30 分」「30 分」のように書く。
 *
 * 小数（0.5 時間）にしないのは、30 分単位で選べることが読み取れないため。
 */
export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} 分`;
  if (rest === 0) return `${hours} 時間`;

  return `${hours} 時間 ${rest} 分`;
};

/**
 * 選んだ時間帯を「13:00〜15:00（2 時間）」のように書く。
 *
 * 長さを添えるのは、終了時刻を 1 枠ずらしただけの選び間違い（14:30 と 15:00）に
 * 時刻の見比べより先に気づけるようにするため。
 */
export const formatSlotRange = (range: SlotRange): string =>
  `${toTokyoTimeKey(range.startMinutes)}〜${toTokyoTimeKey(range.endMinutes)}（${formatDuration(
    range.endMinutes - range.startMinutes,
  )}）`;

/**
 * 選んだ時間帯が申請可能かを判定する。
 *
 * 開始の枠が過ぎている（pastSlots）、または時間帯の 30 分ごとの枠のどれかが
 * 承認済みの予約と重なる（blockedSlots）場合は false を返す。
 */
export const isRangeAvailable = (
  range: SlotRange,
  blockedSlots: ReadonlySet<number>,
  pastSlots: ReadonlySet<number>,
): boolean => {
  if (pastSlots.has(range.startMinutes)) return false;

  for (
    let minutes = range.startMinutes;
    minutes < range.endMinutes;
    minutes += RESERVATION_STEP_MINUTES
  ) {
    if (blockedSlots.has(minutes)) return false;
  }

  return true;
};

/**
 * 時間の軸の上からの位置（0〜1 の割合）にある 30 分の枠の開始（分）。
 *
 * 範囲の外は端の枠（9:00 または 20:30）に丸める。
 */
export const slotAtRatio = (ratio: number): number => {
  const index = Math.min(
    startSlotMinutes.length - 1,
    Math.max(0, Math.floor(ratio * startSlotMinutes.length)),
  );
  return startSlotMinutes[index] ?? OPEN_MINUTES;
};

/**
 * 時間の軸の上からの位置（0〜1 の割合）にいちばん近い 30 分の区切り（9:00〜21:00 の分）。
 *
 * 範囲の外は 9:00・21:00 に丸める。
 */
export const boundaryAtRatio = (ratio: number): number => {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const totalSlots = (CLOSE_MINUTES - OPEN_MINUTES) / RESERVATION_STEP_MINUTES;
  const steps = Math.round(clampedRatio * totalSlots);
  return OPEN_MINUTES + steps * RESERVATION_STEP_MINUTES;
};

/** 時間帯の端。仮の枠の丸のどちらを動かすか */
export type RangeEdge = "start" | "end";

/**
 * 仮の枠の丸を動かしたときの時間帯（ADR-014 決定 12）。
 *
 * - 動かすのは `edge` の側だけ。もう一方の端は変えない。
 * - 30 分より短くはしない（開始は「終了の 30 分前」より後へ、終了は「開始の 30 分後」より前へ動かさない）。
 * - 伸ばすときは、選べない枠の手前で止める（開始を上へ伸ばすなら、上へ 1 枠ずつ見て、選べない枠に当たったら止める。終了を下へ伸ばすときも同じ）。縮めるときは止めない。
 * - 9:00 より前・21:00 より後へは動かさない。
 */
export const resizeRange = (
  range: SlotRange,
  edge: RangeEdge,
  boundaryMinutes: number,
  unselectableSlots: ReadonlySet<number>,
): SlotRange => {
  const clampedBoundary = Math.max(OPEN_MINUTES, Math.min(CLOSE_MINUTES, boundaryMinutes));

  if (edge === "end") {
    // 終了は「開始の 30 分後」より前へ動かさない（30 分より短くしない）
    const minEnd = range.startMinutes + RESERVATION_STEP_MINUTES;
    const targetEnd = Math.max(minEnd, clampedBoundary);

    if (targetEnd <= range.endMinutes) {
      // 縮めるときは止めない
      return { startMinutes: range.startMinutes, endMinutes: targetEnd };
    }

    // 伸ばすときは、選べない枠の手前で止める
    let reached = range.endMinutes;
    for (let slot = range.endMinutes; slot < targetEnd; slot += RESERVATION_STEP_MINUTES) {
      if (unselectableSlots.has(slot)) {
        break;
      }
      reached = slot + RESERVATION_STEP_MINUTES;
    }
    return { startMinutes: range.startMinutes, endMinutes: reached };
  }

  // 開始は「終了の 30 分前」より後へ動かさない（30 分より短くしない）
  const maxStart = range.endMinutes - RESERVATION_STEP_MINUTES;
  const targetStart = Math.min(maxStart, clampedBoundary);

  if (targetStart >= range.startMinutes) {
    // 縮めるときは止めない
    return { startMinutes: targetStart, endMinutes: range.endMinutes };
  }

  // 伸ばすときは、選べない枠の手前で止める
  let reached = range.startMinutes;
  for (
    let slot = range.startMinutes - RESERVATION_STEP_MINUTES;
    slot >= targetStart;
    slot -= RESERVATION_STEP_MINUTES
  ) {
    if (unselectableSlots.has(slot)) {
      break;
    }
    reached = slot;
  }
  return { startMinutes: reached, endMinutes: range.endMinutes };
};
