import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import { ReservationStatus } from "~/domain/reservation";
import {
  addDays,
  atTokyoTime,
  isSameTokyoDay,
  startOfTokyoDay,
  tokyoDayOfWeek,
  toTokyoDateKey,
} from "~/lib/date";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

/** 1 週間に並べる日数。週の始まりは日曜（`startOfTokyoWeek`）。 */
export const DAYS_IN_WEEK = 7;

/** 日曜。`tokyoDayOfWeek` が返す値に合わせている */
const SUNDAY = 0;

/** 土曜。`tokyoDayOfWeek` が返す値に合わせている */
const SATURDAY = 6;

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
 * 1 時間の帯に「時刻 1 行 + 団体名 2 行」が入る高さにしてある（`blockContent`）。
 * 団体名を 1 行で切ると「ロボティクス開発プロジ…」のように読めなくなるため、
 * 折り返せるだけの高さをここで確保している。
 */
export const SLOT_MIN_HEIGHT_REM = 3.25;

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
  /** 曜日（0 が日曜、6 が土曜）。土日の色分けに使う */
  readonly weekday: number;
}

/**
 * 週の日曜から 7 日分を作る。
 *
 * `today` を引数で受け取っているのは、「今日」をサーバーとブラウザで
 * 同じ値にするため。ここで `new Date()` を呼ぶと、サーバーで描いた内容と
 * ブラウザで描き直した内容が食い違うおそれがある。
 */
export const buildWeekDays = (weekStart: Date, today: Date): readonly AvailabilityDay[] =>
  Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
    const date = addDays(startOfTokyoDay(weekStart), index);

    /*
     * 曜日は index ではなく日付から取る。いまは週が日曜始まりなので
     * 両者は一致するが、週の始まりを変えたときに index だけが取り残されて
     * 土日の色がずれるのを防ぐ。
     */
    return {
      date,
      dateKey: toTokyoDateKey(date),
      isToday: isSameTokyoDay(date, today),
      weekday: tokyoDayOfWeek(date),
    };
  });

/**
 * 曜日ごとの色。土曜を青系、日曜を赤系にしているのは、
 * 紙のカレンダーと同じ見分け方にするため。
 *
 * 色を付けるのは**曜日の文字だけ**（`label`）で、日付の数字には付けない。
 * 「9月13日(日)」をまるごと赤くすると、日付そのものが誤っているように見える。
 *
 * `surface` は日付の見出しと時間帯の列の**両方**に敷く。
 * その日の性質を面の色で表す、という点を「今日」と揃えるため。
 * 片方にしか色が無いと、見出しと列が別のものに見えてしまう。
 * 濃さの差（今日は塗りつぶし、週末は 5%）がそのまま目立たせたい順になる。
 *
 * 面をごく薄くしているのは、予約の帯の色（承認済み = 緑系、仮予約 = 橙系）と
 * ぶつけないため。週末かどうかは曜日の文字色で読めるので、面は
 * 「週末がひとまとまりに見える」程度で足りる。
 *
 * 平日は `null` を返す。呼び出し側で「色を付けない」と「今日の色で塗る」を
 * 区別できるようにするため。
 */
export const weekdayStyle = (
  weekday: number,
): { readonly label: string | null; readonly surface: string | null } => {
  if (weekday === SATURDAY) {
    return { label: "text-blue-600 dark:text-blue-400", surface: "bg-blue-500/5" };
  }

  if (weekday === SUNDAY) {
    return { label: "text-red-600 dark:text-red-400", surface: "bg-red-500/5" };
  }

  return { label: null, surface: null };
};

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
 * 色みで**ステータス**だけを表す。自団体かどうかは色で表さない。
 * 以前は同じ色の濃淡（20% と 10%）で分けていたが、離れた列どうしでは
 * 見比べられず、色の見え方によっては差がほとんど消えてしまう。
 *
 * 代わりに自団体の帯は、色以外の印を重ねて目立たせている（`availability-week-grid.tsx`）。
 *
 * - 左端の線を太くする
 * - 枠線を濃くする
 * - 団体名を太字にする
 * - 高さに余裕があれば「自団体」と書く（`blockContent`）
 */
export const blockStyle = (
  status: ReservationStatus,
  isOwnGroup: boolean,
): { readonly box: string; readonly rail: string } => {
  if (status === ReservationStatus.Approved) {
    return isOwnGroup
      ? { box: "border-primary/70 bg-primary/25 text-foreground", rail: "bg-primary" }
      : { box: "border-primary/25 bg-primary/10 text-foreground/80", rail: "bg-primary/40" };
  }

  // 仮予約はまだ確定していないので、枠線を破線にして「これから決まる枠」だと分かるようにする
  return isOwnGroup
    ? {
        box: "border-dashed border-amber-500/80 bg-amber-500/25 text-foreground",
        rail: "bg-amber-500",
      }
    : {
        box: "border-dashed border-amber-500/30 bg-amber-500/10 text-foreground/80",
        rail: "bg-amber-500/40",
      };
};

/** 帯の中の文字 1 行の高さ（rem）。`text-[11px] leading-tight`（11px × 1.25）を rem にしたもの */
const BLOCK_LINE_HEIGHT_REM = 0.875;

/** 帯の上下に取られる高さ（rem）。上下の余白（`py-1`）と枠線の合計 */
const BLOCK_PADDING_REM = 0.625;

/** 団体名を折り返す上限の行数。1 列ぶんの幅があれば、これで長い団体名も収まる */
const MAX_NAME_LINES = 3;

/**
 * 横に並んでいるときの、団体名を折り返す上限の行数。
 *
 * 1 行に入る文字数が半分以下になるぶん、行数で取り返す。
 * 上限を設けているのは、長い帯で団体名だけが縦に伸びないようにするため。
 */
const MAX_NARROW_NAME_LINES = 6;

/**
 * 帯の長さ（分）から、文字が何行入るかを見積もる。
 *
 * 高さの基準に `SLOT_MIN_HEIGHT_REM` を使っているのは、これが帯の最小の高さだから。
 * 画面が高いときは帯も伸びるので、ここで数えた行数より余裕がある。
 * 逆に伸びたぶんまで当てにすると、画面が低いときに文字がはみ出す。
 */
const linesInBlock = (durationMinutes: number): number => {
  const heightRem = (durationMinutes / 60) * SLOT_MIN_HEIGHT_REM;

  return Math.max(1, Math.floor((heightRem - BLOCK_PADDING_REM) / BLOCK_LINE_HEIGHT_REM));
};

/** 帯 1 本に何を書けるか。 */
export interface BlockContent {
  /** 時刻を出すか */
  readonly showTime: boolean;
  /** ステータス（と自団体かどうか）を出すか */
  readonly showStatus: boolean;
  /** 使用人数を出すか */
  readonly showHeadCount: boolean;
  /** 団体名を何行まで折り返すか */
  readonly nameLines: number;
}

/**
 * 帯に書く中身を、入る高さと幅から決める。
 *
 * 短い帯にすべてを書こうとすると、どの行も切れて読めなくなる。
 * 逆に長い帯は、時刻と団体名だけだと上に寄って下が空く。
 * そこで「入る行数」を数えて、入るぶんだけ書く。
 *
 * 横に並んでいるとき（`columnCount` が 2 以上）は団体名だけにする。
 * 幅が半分以下になり、狭い画面では 1 行に 3 文字ほどしか入らないので、
 * 時刻やステータスまで書くとどの行も数文字で切れてしまう。
 * 書かなかったぶんは帯を押せば出るので、この画面でいちばん知りたい
 * 「どの団体の予約か」に行をすべて回す。
 *
 * @param durationMinutes 帯の長さ（分）。表示範囲に切り詰めたあとの長さ
 * @param columnCount その帯が横に何列で並んでいるか
 */
export const blockContent = (durationMinutes: number, columnCount: number): BlockContent => {
  const lines = linesInBlock(durationMinutes);

  if (columnCount > 1) {
    return {
      showTime: false,
      showStatus: false,
      showHeadCount: false,
      nameLines: Math.min(MAX_NARROW_NAME_LINES, lines),
    };
  }

  const showTime = lines >= 3;
  const showStatus = lines >= 5;
  const showHeadCount = lines >= 6;

  const usedLines = [showTime, showStatus, showHeadCount].filter(Boolean).length;

  return {
    showTime,
    showStatus,
    showHeadCount,
    nameLines: Math.min(MAX_NAME_LINES, Math.max(1, lines - usedLines)),
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
