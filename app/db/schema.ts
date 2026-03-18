import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// INFO-006: ユーザー
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isStaff: integer("is_staff", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// INFO-003: 団体
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// INFO-005: メンバーシップ
export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: text("joined_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("memberships_user_group_idx").on(t.userId, t.groupId)],
);

// INFO-002: 施設/設備
export const facilities = sqliteTable("facilities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  photoUrl: text("photo_url"),
  googleCalendarId: text("google_calendar_id"),
  calendarUrl: text("calendar_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// INFO-001: 予約
export const reservations = sqliteTable("reservations", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  facilityId: text("facility_id")
    .notNull()
    .references(() => facilities.id),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  headcount: integer("headcount"),
  note: text("note"),
  status: text("status", {
    enum: [
      "provisional",
      "approved",
      "withdrawn",
      "rejected",
      "cancelled",
      "cancelled_by_staff",
    ],
  }).notNull(),
  statusReason: text("status_reason"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// INFO-004: メッセージ
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id")
    .notNull()
    .references(() => reservations.id, { onDelete: "cascade" }),
  senderId: text("sender_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  sentAt: text("sent_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// 型エクスポート
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Facility = typeof facilities.$inferSelect;
export type NewFacility = typeof facilities.$inferInsert;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type ReservationStatus =
  | "provisional"
  | "approved"
  | "withdrawn"
  | "rejected"
  | "cancelled"
  | "cancelled_by_staff";

export type MembershipRole = "owner" | "member";
