import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CalendarSyncStatus } from "~/domain/calendar";

export const calendarSyncTaskTable = sqliteTable(
  "calendar_sync_task",
  {
    /** 自動採番の主キー（INSERT ... SELECT でまとめて積むため SQL 側で採番） */
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** 予約 ID（突き合わせで DB に無い予約の予定を掃除することもあるため、外部キーは張らない） */
    reservationId: text("reservation_id").notNull(),

    /** 変更前の施設 ID（変更前のカレンダーからも削除するため。外部キーは張らない） */
    previousFacilityId: text("previous_facility_id"),

    /** タスクの状態（pending / processing / dead）。成功した行は削除される */
    status: text("status")
      .$type<CalendarSyncStatus>()
      .notNull()
      .$default(() => CalendarSyncStatus.Pending),

    /** 試行回数（backoff の指数計算と、諦める判断に使用） */
    attemptCount: integer("attempt_count").notNull().default(0),

    /** 次に試行してよい時刻 */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** 直近の失敗エラー（調査用） */
    lastError: text("last_error"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // cron が毎分投げるクエリの WHERE 句に対応する複合インデックス
  (table) => [index("calendar_sync_task_due_idx").on(table.status, table.nextAttemptAt)],
);
