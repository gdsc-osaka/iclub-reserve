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

/** 曜日まで含めた日付の表示形式。予約は曜日で覚えている人が多いので曜日を出す */
const dateWithWeekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "Asia/Tokyo",
});

/** 時刻だけの表示形式 */
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

/**
 * 同じ日かどうかの判定に使う鍵。
 *
 * 表示には使わないので体裁は問わない。日本時間での年月日が同じなら
 * 同じ文字列になる、という一点だけが必要。
 */
const dayKeyFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tokyo",
});

/**
 * 2 つの日時が日本時間で同じ日かどうかを判定する。
 *
 * `getDate()` などで比べると実行環境のタイムゾーンで判定してしまい、
 * サーバー (UTC) では日をまたいでいる、といったずれが起きる。
 */
export const isSameDayInJapan = (a: Date, b: Date): boolean =>
  dayKeyFormatter.format(a) === dayKeyFormatter.format(b);

/**
 * 予約の利用時間帯を 1 行で表す。
 *
 * 同じ日に収まっていれば日付を 1 度しか書かない。
 * 予約のほとんどは日をまたがないので、そちらを読みやすい形に寄せている。
 *
 * @example
 *
 * formatReservationPeriod(new Date("2026-06-28T17:54+09:00"), new Date("2026-06-28T19:00+09:00"))
 * // → "2026年6月28日(日) 17:54〜19:00"
 *
 * formatReservationPeriod(new Date("2026-06-28T22:00+09:00"), new Date("2026-06-29T09:00+09:00"))
 * // → "2026年6月28日(日) 22:00 〜 2026年6月29日(月) 09:00"
 */
export const formatReservationPeriod = (startAt: Date, endAt: Date): string =>
  isSameDayInJapan(startAt, endAt)
    ? `${dateWithWeekdayFormatter.format(startAt)} ${timeFormatter.format(startAt)}〜${timeFormatter.format(endAt)}`
    : `${dateWithWeekdayFormatter.format(startAt)} ${timeFormatter.format(startAt)} 〜 ${dateWithWeekdayFormatter.format(endAt)} ${timeFormatter.format(endAt)}`;
