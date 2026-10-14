import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 日本の祝日テーブル。
 *
 * Google の「日本の祝日」公開カレンダーから取得した祝日の一覧を保持する。
 * カレンダーの空き状況（/availability）の日付色（日曜と同じ赤系）の判定に使用する。
 */
export const holidayTable = sqliteTable("holiday", {
  /** 日付（"YYYY-MM-DD" 形式の主キー） */
  date: text("date").primaryKey(),
  /** 祝日名（画面には出さないが、ログや調査のために残す） */
  name: text("name").notNull(),
});

export type HolidayRow = typeof holidayTable.$inferSelect;
export type InsertHolidayRow = typeof holidayTable.$inferInsert;
