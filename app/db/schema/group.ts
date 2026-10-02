/**
 * 団体（グループ）・メンバー・招待のスキーマ定義。
 *
 * 【手書きである理由（ADR-003）】
 * もとは Better Auth の organization プラグインが生成していたが、
 * アプリ側でプラグインの実行時 API を一切使っておらず、また事務局（COND-009）は操作する団体の
 * group_member 行を持たないのが普通で、その場合プラグインの書き込み API が構造的に通らないため、
 * プラグインを撤去して自前の手書きテーブルに戻した。
 *
 * 【SQL 予約語について】
 * `group` は SQL の予約語だが、Drizzle は識別子を常に引用符（SQLite ではバッククォート等）で
 * 囲んで出力するため問題にならない。ただし手で生 SQL を書く場合は、必ず `"group"` と引用符で囲むこと。
 *
 * 【日付の既定値について】
 * `group.createdAt` / `updatedAt` に `$defaultFn` を設定していないのは、
 * 既存の DDL に SQL 既定値が無く、ここで追加すると不要なマイグレーションが発生するため。
 * 値は呼び出し側（リポジトリ層）が明示的に渡す。
 */

import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { GroupStatus } from "~/domain/group";
import { InvitationStatus } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { user } from "./auth";

export const groupTable = sqliteTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").$type<GroupStatus>().notNull().default(GroupStatus.Pending),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * 団体のメンバー所属を表すテーブル。
 *
 * `(group_id, user_id)` の UNIQUE 制約は、COND-007（1人1役割）および
 * 「同じユーザーが同じ団体に複数所属行を持つ異常データ」を DB 側で防ぐためのもの。
 * この一意制約が存在することにより、管理者の人数を SQL の count() で安全に数えられる。
 */
export const groupMemberTable = sqliteTable(
  "group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groupTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<MembershipRole>().notNull().default(MembershipRole.Member),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("group_member_groupId_userId_unique").on(table.groupId, table.userId),
    index("group_member_userId_idx").on(table.userId),
  ],
);

/**
 * 団体へのメンバー招待を表すテーブル。
 *
 * `role` は NOT NULL で、招待時点で割り当てる役割（管理者またはメンバー）が確定している。
 */
export const groupInvitationTable = sqliteTable(
  "group_invitation",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groupTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<MembershipRole>().notNull(),
    status: text("status").$type<InvitationStatus>().notNull().default(InvitationStatus.Pending),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("group_invitation_groupId_idx").on(table.groupId),
    index("group_invitation_email_idx").on(table.email),
  ],
);

/*
 * リレーション定義。
 *
 * NOTE: relations(user, ...) をここで再定義してはならない（Drizzle では同一テーブルに対して
 * 1 回しか relations を宣言できないため）。
 * 本プロジェクトは db.query.*（リレーショナルクエリ）を使っておらず SQL JOIN を直接記述しているため、
 * groupMemberTable / groupInvitationTable から user への片方向リレーションで十分である。
 */
export const groupRelations = relations(groupTable, ({ many }) => ({
  members: many(groupMemberTable),
  invitations: many(groupInvitationTable),
}));

export const groupMemberRelations = relations(groupMemberTable, ({ one }) => ({
  group: one(groupTable, {
    fields: [groupMemberTable.groupId],
    references: [groupTable.id],
  }),
  user: one(user, {
    fields: [groupMemberTable.userId],
    references: [user.id],
  }),
}));

export const groupInvitationRelations = relations(groupInvitationTable, ({ one }) => ({
  group: one(groupTable, {
    fields: [groupInvitationTable.groupId],
    references: [groupTable.id],
  }),
  user: one(user, {
    fields: [groupInvitationTable.inviterId],
    references: [user.id],
  }),
}));
