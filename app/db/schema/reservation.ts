import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "./auth";
import { groupTable } from "./group";
import { type UnlockArrangement, ReservationStatus } from "~/domain/reservation";

export const facilityTable = sqliteTable("facility", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  name: text().notNull(),

  description: text("description"),

  photoUrl: text("photo_url"),

  googleCalendarId: text("google_calendar_id"),

  calendarUrl: text("calendar_url"),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reservationTable = sqliteTable("reservation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  groupId: text("group_id")
    .references(() => groupTable.id)
    .notNull(),

  facilityId: text("facility_id")
    .references(() => facilityTable.id)
    .notNull(),

  startAt: integer("start_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  endAt: integer("end_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  headCount: integer("head_count").notNull(),

  note: text("note"),

  status: text("status")
    .$type<ReservationStatus>()
    .notNull()
    .$default(() => ReservationStatus.Provisional),

  /**
   * 施設の解錠の手配（INFO-001 / STATE-004 / COND-027）。
   *
   * "required"（要手配）、"arranged"（手配済み）、"not_required"（不要）。
   * null は未定を表す。
   */
  unlockArrangement: text("unlock_arrangement").$type<UnlockArrangement>(),

  statusReason: text("status_reason"),

  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  /**
   * 申請日時。いまの施設・時間帯を申し込んだ日時（INFO-001.requested_at）。
   *
   * 作成日時・更新日時と違って既定値を持たせていない。作成日時と別々に既定値を取ると
   * 1 ミリ秒ずれることがあり、施設・日時を変えていないのに「申し込み直した」予約に見えてしまう。
   * 書き込む側で必ず決めさせるため、書き忘れると型エラーになるようにしてある。
   */
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reservationMessageTable = sqliteTable(
  "reservation_message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),

    reservationId: text("reservation_id")
      .references(() => reservationTable.id)
      .notNull(),

    senderId: text("sender_id")
      .references(() => user.id)
      .notNull(),

    sentAsStaff: integer("sent_as_staff", { mode: "boolean" }).notNull(),

    body: text("body").notNull(),

    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("reservation_message_reservation_sent_at_idx").on(table.reservationId, table.sentAt),
  ],
);

/**
 * 既読の記録テーブル（INFO-012）。
 *
 * 利用者がある予約の動きをどこまで確認したかを表す。
 * 利用者と予約の組ごとに、最後に確認した日時（last_read_at）を 1 つだけ持つ。
 */
export const reservationReadTable = sqliteTable(
  "reservation_read",
  {
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    reservationId: text("reservation_id")
      .references(() => reservationTable.id, { onDelete: "cascade" })
      .notNull(),
    lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.reservationId] }),
    index("reservation_read_reservation_id_idx").on(table.reservationId),
  ],
);
