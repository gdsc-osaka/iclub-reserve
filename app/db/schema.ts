import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("users", {
  id: text().primaryKey(),
  email: text().notNull(),
  name: text().notNull(),
  is_staff: integer({ mode: "boolean" }).notNull(),
  created_at: integer({ mode: "timestamp_ms" }).notNull(),
  updated_at: integer({ mode: "timestamp_ms" }).notNull(),
});
