import { addDays, atTokyoTime, startOfTokyoWeek, toTokyoDateKey } from "~/lib/date";

/**
 * 予約の日時を、テストを動かした日から数えて決める。
 *
 * サーバーの時計は止められないので、固定の日付を書くといずれ「過ぎた日」になり、
 * 申請できなくなってテストが落ちる。いつ動かしても未来になるよう、
 * 「来週の◯曜日」のように決める。時刻はすべて日本時間。
 */

/**
 * 曜日。アプリ（`~/lib/date` の `tokyoDayOfWeek`）と同じく日曜を 0 として数える。
 * アプリの週は日曜に始まるので、「来週」は次の日曜からの 7 日間になる。
 */
export const Weekday = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
} as const;
export type Weekday = (typeof Weekday)[keyof typeof Weekday];

/** 来週の `weekday` の、日本時間 `hour` 時 `minute` 分 */
export const nextWeekAt = (weekday: Weekday, hour: number, minute = 0): Date =>
  atTokyoTime(addDays(startOfTokyoWeek(new Date()), 7 + weekday), hour, minute);

/** 画面の URL に渡す日付（`2026-09-30` の形） */
export const toDateKey = (date: Date): string => toTokyoDateKey(date);
