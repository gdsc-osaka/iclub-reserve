import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

export const usersTable = sqliteTable("users", {
  id: text().primaryKey(),
  email: text().notNull(),
  name: text().notNull(),
  is_staff: integer({ mode: "boolean" }).notNull(),
  created_at: integer({ mode: "timestamp_ms" }).notNull(),
  updated_at: integer({ mode: "timestamp_ms" }).notNull(),
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

export enum MembershipRole {
  Owner = "owner",
  Member = "member",
}
export const membershipTable = sqliteTable("membership", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  name: text("id", { length: 100 }).notNull(),

  userId: text("user_id")
    .references(() => usersTable.id)
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
