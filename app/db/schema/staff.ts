/**
 * 事務局招待のスキーマ定義（INFO-009）。
 *
 * 事務局への招待を表すテーブル。
 * 団体の招待（INFO-007）とは、団体を持たないこと・与えるものがロールではなく事務局権限であることが
 * 異なるため、別のテーブルとして管理する。
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { InvitationStatus } from "~/domain/invitation";
import { user } from "./auth";

export const staffInvitationTable = sqliteTable(
  "staff_invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    status: text("status").$type<InvitationStatus>().notNull().default(InvitationStatus.Pending),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("staff_invitation_email_idx").on(table.email)],
);
