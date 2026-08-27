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
