/**
 * 日時の表示形式。
 *
 * タイムゾーンを日本時間に固定しているのは、サーバー（UTC）とブラウザ（利用者の設定）で
 * 表示がずれてしまい、画面のちらつき（ハイドレーションのずれ）が起きるのを防ぐため。
 */
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

/**
 * Date を日本語の日時形式に変換
 *
 * @example
 *
 * formatDateTime(new Date("2026-06-28T17:54:30+09:00"))
 * // → "2026年6月28日 17:54"
 */
export const formatDateTime = (date: Date) => dateTimeFormatter.format(date);

/**
 * 日本標準時と協定世界時（UTC）の差。
 *
 * 日付の計算だけは `Intl` ではなくこの固定値でずらしている。
 * `Intl` は「表示用の文字列」を作る道具で、「7 日後の 0 時」のような
 * 計算には使えないため。日本標準時にはサマータイムが無く、
 * 1951 年以降ずっと UTC+9 のままなので、固定値で計算して問題ない。
 */
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 1 日のミリ秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 1 分のミリ秒数 */
const MINUTE_MS = 60 * 1000;

/**
 * 時刻だけを表示する形式。
 *
 * @example formatTime(new Date("2026-09-12T14:00:00+09:00")) // → "14:00"
 */
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

/**
 * 「9月12日(土)」の形式。カレンダーの日付見出しに使う。
 */
const monthDayWeekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "Asia/Tokyo",
});

/** 「2026年9月12日(土)」の形式。期間の見出しなど、年まで必要な場所に使う。 */
const fullDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "Asia/Tokyo",
});

/** Date を日本時間の「14:00」形式にする */
export const formatTime = (date: Date) => timeFormatter.format(date);

/** Date を日本時間の「9月12日(土)」形式にする */
export const formatMonthDay = (date: Date) => monthDayWeekdayFormatter.format(date);

/** Date を日本時間の「2026年9月12日(土)」形式にする */
export const formatFullDate = (date: Date) => fullDateFormatter.format(date);

/**
 * 日本時間での「その日の 0 時ちょうど」を返す。
 *
 * `Date` の `getHours()` などを使わないのは、サーバー（UTC）と
 * ブラウザ（利用者の設定）で結果が変わってしまうため。
 * 同じ瞬間を見ても、サーバーでは前日、ブラウザでは当日になることがある。
 */
export const startOfTokyoDay = (date: Date): Date =>
  new Date(Math.floor((date.getTime() + TOKYO_OFFSET_MS) / DAY_MS) * DAY_MS - TOKYO_OFFSET_MS);

/** 日付を日数だけ進める（負の数を渡せば戻る） */
export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

/**
 * 日本時間での曜日。0 が日曜、6 が土曜。
 *
 * 日本時間にずらしてから `getUTCDay()` を読むことで、
 * 実行環境のタイムゾーンに左右されないようにしている。
 */
const tokyoDayOfWeek = (date: Date): number =>
  new Date(date.getTime() + TOKYO_OFFSET_MS).getUTCDay();

/**
 * その日を含む週の月曜日の 0 時（日本時間）を返す。
 *
 * 週の始まりを月曜にしているのは、施設の利用が平日中心で、
 * 土日を週の両端に離してしまうと週末の予定が見比べにくくなるため。
 */
export const startOfTokyoWeek = (date: Date): Date => {
  const dayOfWeek = tokyoDayOfWeek(date);
  // 日曜 (0) は 6 日前が月曜。それ以外は (曜日 - 1) 日前が月曜
  const daysFromMonday = (dayOfWeek + 6) % 7;

  return addDays(startOfTokyoDay(date), -daysFromMonday);
};

/**
 * 日本時間での「その日の 0 時から何分経ったか」を返す。
 *
 * カレンダーで予約の帯を縦のどこに置くかを決めるのに使う。
 */
export const tokyoMinutesOfDay = (date: Date): number =>
  (date.getTime() - startOfTokyoDay(date).getTime()) / MINUTE_MS;

/**
 * Date を日本時間の "YYYY-MM-DD" にする。URL のクエリに載せる形式。
 *
 * `toISOString()` を使わないこと。あちらは UTC なので、
 * 日本時間の 9 月 13 日 0 時が "2026-09-12" になってしまう。
 */
export const toTokyoDateKey = (date: Date): string =>
  new Date(date.getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);

/** "YYYY-MM-DD" の形かどうかを見るための形式。日付として妥当かまでは見ない */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-MM-DD" を日本時間のその日の 0 時に変換する。
 *
 * URL のクエリは利用者が自由に書き換えられるので、
 * 形式が違うときと、"2026-02-31" のように存在しない日付のときは null を返す。
 * 呼び出し側で「その場合は今日にする」といった既定値を決めること。
 */
export const parseTokyoDateKey = (value: string | null): Date | null => {
  if (value === null || !DATE_KEY_PATTERN.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  /*
   * "2026-02-31" は Date に渡すと 3 月 3 日として解釈される（繰り上がる）。
   * 元の文字列に戻して一致を確かめることで、存在しない日付を弾く。
   */
  if (parsed.toISOString().slice(0, 10) !== value) return null;

  return new Date(parsed.getTime() - TOKYO_OFFSET_MS);
};

/** "HH:MM" の形かどうかを見るための形式。24 時以降や 60 分以降は弾く */
const TIME_KEY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "HH:MM" を「その日の 0 時から何分か」に変換する。
 *
 * フォームの `<select>` やクエリから受け取った時刻を、
 * タイムライン上の位置（分）と同じ単位にそろえるために使う。
 *
 * 値は利用者が自由に書き換えられるので、形式が違うときは null を返す。
 * 呼び出し側で「その場合は未選択にする」といった既定値を決めること。
 *
 * @example parseTokyoTimeKey("09:30") // → 570
 */
export const parseTokyoTimeKey = (value: string | null): number | null => {
  if (value === null) return null;

  const matched = TIME_KEY_PATTERN.exec(value);
  if (matched === null) return null;

  return Number(matched[1]) * 60 + Number(matched[2]);
};

/**
 * 「その日の 0 時から何分か」を "HH:MM" にする。
 *
 * 24:00（＝1440 分）も表せる。利用可能時間の終わりが 24 時になった場合に、
 * 終了時刻の選択肢を「0:00」と書いて前日に見せてしまわないようにするため。
 *
 * @example toTokyoTimeKey(570) // → "09:30"
 */
export const toTokyoTimeKey = (minutes: number): string => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

/**
 * 日本時間の「その日の 0 時から指定した分だけ進んだ時刻」を返す。
 *
 * タイムライン上の位置（分）を日時に戻すのに使う。
 * `atTokyoTime(day, 0, minutes)` と結果は同じだが、
 * 「時と分」ではなく「0 時からの分」を扱っていることが読めるように分けている。
 */
export const atTokyoMinutes = (day: Date, minutes: number): Date =>
  new Date(startOfTokyoDay(day).getTime() + minutes * MINUTE_MS);

/**
 * 日本時間の「その日の指定した時・分」を返す。
 *
 * @param day その日のどこかを指す Date
 * @param hour 0-23 の時
 * @param minute 0-59 の分（省略時は 0）
 */
export const atTokyoTime = (day: Date, hour: number, minute = 0): Date =>
  atTokyoMinutes(day, hour * 60 + minute);

/** 2 つの日付が日本時間で同じ日かどうか */
export const isSameTokyoDay = (a: Date, b: Date): boolean =>
  startOfTokyoDay(a).getTime() === startOfTokyoDay(b).getTime();

/**
 * 予約の開始〜終了を 1 つの文字列にする。
 *
 * 日をまたぐ予約を時刻だけで書くと「20:00〜10:00」となり、
 * 逆向きの範囲を書いたように見えてしまう。そのため、終わりが翌日以降なら
 * 日付が変わることを添える。
 *
 * @example formatTimeRange(9/12 10:00, 9/12 12:00) // → "10:00〜12:00"
 * @example formatTimeRange(9/12 20:00, 9/13 10:00) // → "20:00〜翌10:00"
 * @example formatTimeRange(9/12 20:00, 9/14 10:00) // → "20:00〜9月14日(月) 10:00"
 */
export const formatTimeRange = (startAt: Date, endAt: Date): string => {
  if (isSameTokyoDay(startAt, endAt)) {
    return `${formatTime(startAt)}〜${formatTime(endAt)}`;
  }

  /*
   * 翌日までなら「翌」の 1 文字で足りる。カレンダーの帯は 1 日ぶんの幅しかなく、
   * 日付をそのまま入れると団体名まで押し出してしまう。
   * 2 日以上またぐ予約は珍しいので、そのときだけ日付を書く。
   */
  if (isSameTokyoDay(addDays(startAt, 1), endAt)) {
    return `${formatTime(startAt)}〜翌${formatTime(endAt)}`;
  }

  return `${formatTime(startAt)}〜${formatMonthDay(endAt)} ${formatTime(endAt)}`;
};
