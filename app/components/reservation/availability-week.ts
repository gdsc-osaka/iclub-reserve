import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import { ReservationStatus } from "~/domain/reservation";
import { addDays, atTokyoTime, isSameTokyoDay, startOfTokyoDay, toTokyoDateKey } from "~/lib/date";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

/** 1 週間に並べる日数。週の始まりは月曜（`startOfTokyoWeek`）。 */
export const DAYS_IN_WEEK = 7;

/** 時間軸の開始・終了を「0 時から何分」で表したもの。位置の計算はすべてこの単位で行う。 */
export const OPEN_MINUTES = FACILITY_OPEN_HOUR * 60;
export const CLOSE_MINUTES = FACILITY_CLOSE_HOUR * 60;

/** 時間軸ぜんぶの長さ（分）。帯の位置を百分率にするときの分母になる */
export const AXIS_MINUTES = CLOSE_MINUTES - OPEN_MINUTES;

/** 時間軸に並ぶ「時」の一覧。9, 10, ... 21（終端の目盛りを出すため 21 も含む） */
export const axisHours: readonly number[] = Array.from(
  { length: FACILITY_CLOSE_HOUR - FACILITY_OPEN_HOUR + 1 },
  (_, index) => FACILITY_OPEN_HOUR + index,
);

/**
 * 空き枠として押せる「時」の一覧。9, 10, ... 20
 *
 * 終端（21 時）を含めないのは、21 時の枠が存在しないため。
 * 目盛り（`axisHours`）とは 1 つずれる。
 */
export const slotHours: readonly number[] = Array.from(
  { length: FACILITY_CLOSE_HOUR - FACILITY_OPEN_HOUR },
  (_, index) => FACILITY_OPEN_HOUR + index,
);

/**
 * 空き枠 1 つ（1 時間）の最低の高さ（rem）。
 *
 * 画面が高いときは余白いっぱいまで伸ばすが、ここより低くはしない。
 * 予約の帯には時刻と団体名を 2 行で入れているので、
 * これ以上潰すと文字が切れて読めなくなる。
 */
export const SLOT_MIN_HEIGHT_REM = 2.75;

/** 時間軸ぜんぶの最低の高さ（rem）。これより狭い画面ではカレンダーの中を縦にスクロールさせる */
export const GRID_MIN_HEIGHT_REM = slotHours.length * SLOT_MIN_HEIGHT_REM;

/** カレンダーの 1 日分。 */
export interface AvailabilityDay {
  /** その日の 0 時（日本時間） */
  readonly date: Date;
  /** URL のクエリに載せる "YYYY-MM-DD" */
  readonly dateKey: string;
  /** 今日かどうか。列を目立たせるために使う */
  readonly isToday: boolean;
}

/**
 * 週の月曜から 7 日分を作る。
 *
 * `today` を引数で受け取っているのは、「今日」をサーバーとブラウザで
 * 同じ値にするため。ここで `new Date()` を呼ぶと、サーバーで描いた内容と
 * ブラウザで描き直した内容が食い違うおそれがある。
 */
export const buildWeekDays = (weekStart: Date, today: Date): readonly AvailabilityDay[] =>
  Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
    const date = addDays(startOfTokyoDay(weekStart), index);

    return { date, dateKey: toTokyoDateKey(date), isToday: isSameTokyoDay(date, today) };
  });

/** タイムラインに描く帯 1 本。位置はその日の 0 時からの分で表す。 */
export interface AvailabilityBlock {
  readonly reservation: AvailabilityReservation;
  /** 表示範囲に収めた開始位置（分）。9:00 より前から続く予約は 9:00 に切り詰める */
  readonly startMinutes: number;
  /** 表示範囲に収めた終了位置（分） */
  readonly endMinutes: number;
}

/** ある日時が、基準の日の 0 時から何分後かを返す（日をまたぐと 1440 を超える） */
const minutesFromDayStart = (date: Date, dayStart: Date): number =>
  (date.getTime() - dayStart.getTime()) / (60 * 1000);

/**
 * 1 日分の帯を、時間軸に収まる形で取り出す。
 *
 * 予約は日をまたぐことも、利用可能時間の外にはみ出すこともありうるので、
 * 表示できる範囲へ切り詰める。切り詰めるのは帯の位置だけで、
 * 吹き出しに出す時刻は予約そのものの値を使うこと。
 * 切り詰めた時刻を出すと、9 時前から続いている予約が 9 時開始に見えてしまう。
 */
export const toDayBlocks = (
  day: AvailabilityDay,
  reservations: readonly AvailabilityReservation[],
): readonly AvailabilityBlock[] => {
  const dayOpen = atTokyoTime(day.date, FACILITY_OPEN_HOUR);
  const dayClose = atTokyoTime(day.date, FACILITY_CLOSE_HOUR);

  return reservations
    .filter((reservation) => reservation.startAt < dayClose && reservation.endAt > dayOpen)
    .map((reservation) => ({
      reservation,
      startMinutes: Math.max(OPEN_MINUTES, minutesFromDayStart(reservation.startAt, day.date)),
      endMinutes: Math.min(CLOSE_MINUTES, minutesFromDayStart(reservation.endAt, day.date)),
    }));
};

/**
 * 承認済みの予約で埋まっている「時」を返す。
 *
 * ここに入る時間帯からは申請を始められないようにする。
 * 重複を禁じているのは承認済みの予約に対してだけなので（COND-001）、
 * 仮予約どうしは重なってよい。仮予約まで塞ぐと、
 * 同じ時間帯に別の団体が申請して事務局に選んでもらう、という使い方ができなくなる。
 *
 * 1 時間の枠に少しでもかかっていれば埋まっている扱いにする。
 * この画面が押させるのは 1 時間単位の枠なので、
 * 「10:30 まで埋まっている 10 時の枠」を押せるようにしても、
 * 申請できる時間帯を選び直せる場所がまだ無い。
 */
export const toOccupiedHours = (blocks: readonly AvailabilityBlock[]): ReadonlySet<number> => {
  const occupied = new Set<number>();

  for (const block of blocks) {
    if (block.reservation.status !== ReservationStatus.Approved) continue;

    for (const hour of slotHours) {
      const slotStart = hour * 60;

      if (block.startMinutes < slotStart + 60 && block.endMinutes > slotStart) {
        occupied.add(hour);
      }
    }
  }

  return occupied;
};

/** 位置（分）を時間軸の中の百分率にする。`top` と `height` の両方に使う */
export const toAxisPercent = (minutes: number): number => (minutes / AXIS_MINUTES) * 100;

/**
 * 帯の配色。
 *
 * 色みで**ステータス**を、濃さで**自団体かどうか**を表している。
 * 2 つを別々の印（色と枠線の形など）で表すと、スマホの幅では細かすぎて読めない。
 *
 * 自団体の予約を濃くしているのは、この画面で真っ先に探すのが
 * 「自分たちの予約がいつ入っているか」だと考えられるため。
 */
export const blockStyle = (
  status: ReservationStatus,
  isOwnGroup: boolean,
): { readonly box: string; readonly rail: string } => {
  if (status === ReservationStatus.Approved) {
    return isOwnGroup
      ? { box: "border-primary/40 bg-primary/20 text-foreground", rail: "bg-primary" }
      : { box: "border-primary/25 bg-primary/10 text-foreground/80", rail: "bg-primary/40" };
  }

  // 仮予約はまだ確定していないので、枠線を破線にして「これから決まる枠」だと分かるようにする
  return isOwnGroup
    ? {
        box: "border-dashed border-amber-500/50 bg-amber-500/20 text-foreground",
        rail: "bg-amber-500",
      }
    : {
        box: "border-dashed border-amber-500/30 bg-amber-500/10 text-foreground/80",
        rail: "bg-amber-500/40",
      };
};

/**
 * 予約申請フォーム（SCR-002）へ持っていく初期値。
 *
 * 押した場所が知っていることだけを入れる。
 * 施設だけを選んでいる状態で日時まで埋めてしまうと、
 * フォームを開いた人が「いつの予約だったか」を確かめ直すことになる。
 *
 * - 空き枠を押した: 施設 + 日付 + 時刻
 * - 日付の「＋」を押した: 施設 + 日付
 * - 施設名の横の「＋」を押した: 施設のみ
 */
export interface ReservationDraft {
  readonly facility: AvailabilityFacility;
  readonly day: AvailabilityDay | null;
  readonly startHour: number | null;
}
