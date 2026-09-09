import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { organization } from "./auth";
import { ReservationStatus } from "~/domain/reservation";

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
    .references(() => organization.id)
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

  statusReason: text("status_reason"),

  createdBy: text("created_by"),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
