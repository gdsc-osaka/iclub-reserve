import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "./auth";

export const GroupReservationStatus = {
  Provisional: "provisional",
  Approved: "approved",
  Withdrawn: "withdrawn",
  Rejected: "rejected",
  Cancelled: "cancelled",
  CancelledByStaff: "cancelled_by_staff",
} as const;

export type GroupReservationStatus =
  (typeof GroupReservationStatus)[keyof typeof GroupReservationStatus];

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

export const groupsTable = sqliteTable("groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  name: text("name", { length: 100 }).notNull(),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const groupReservationTable = sqliteTable("reservation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  groupId: text("group_id")
    .references(() => groupsTable.id)
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
    .$type<GroupReservationStatus>()
    .notNull()
    .$default(() => GroupReservationStatus.Provisional),

  statusReason: text("status_reason"),

  createdBy: text("created_by"),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const MembershipRole = {
  Owner: "owner",
  Member: "member",
} as const;

export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const membershipTable = sqliteTable("membership", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  name: text("name", { length: 100 }).notNull(),

  userId: text("user_id")
    .references(() => user.id)
    .notNull(),

  groupId: text("group_id")
    .references(() => groupsTable.id)
    .notNull(),

  role: text("role").$type<MembershipRole>().notNull(),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Group = typeof groupsTable.$inferSelect;
export type NewGroup = typeof groupsTable.$inferInsert;
