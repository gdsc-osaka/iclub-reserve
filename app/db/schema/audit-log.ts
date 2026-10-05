import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AuditLogAction, AuditLogChanges, AuditLogTargetType } from "~/domain/audit-log";

/**
 * 操作履歴テーブル（INFO-008）。
 *
 * 予約・団体・メンバーシップ・招待・施設・事務局権限に対して人が行った操作を追記する（COND-013）。
 * 記録対象や操作者が後で削除されても記録を残せるよう、外部キー制約は張らず論理参照とする。
 */
export const auditLogTable = sqliteTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),

    /** 操作日時（ミリ秒単位タイムスタンプ） */
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),

    /** 操作者のユーザー ID（論理参照） */
    actorId: text("actor_id").notNull(),

    /** 事務局の横断権限による操作かどうか（COND-009 / COND-012） */
    actedAsStaff: integer("acted_as_staff", { mode: "boolean" }).notNull(),

    /** 操作の種類（VAR-002） */
    action: text("action").$type<AuditLogAction>().notNull(),

    /** 記録対象の種類（VAR-003） */
    targetType: text("target_type").$type<AuditLogTargetType>().notNull(),

    /** 記録対象の ID（論理参照） */
    targetId: text("target_id").notNull(),

    /** 記録対象が属する団体の ID（論理参照。施設や事務局権限など団体に属さないものは NULL） */
    groupId: text("group_id"),

    /** 変更前・変更後の内容（JSON） */
    changes: text("changes", { mode: "json" }).$type<AuditLogChanges>().notNull(),
  },
  (table) => [
    // 全件の新しい順（occurred_at 降順、id 降順）および期間絞り込みを高速化する
    index("audit_log_occurred_at_idx").on(table.occurredAt, table.id),
    // 団体ごとの絞り込みと時系列順の取得を高速化する
    index("audit_log_group_idx").on(table.groupId, table.occurredAt),
    // 操作者ごとの絞り込みと時系列順の取得を高速化する
    index("audit_log_actor_idx").on(table.actorId, table.occurredAt),
    // 対象の種類ごとの絞り込み、および対象指定（予約詳細・団体詳細など）の履歴欄で高速に引くための複合インデックス
    index("audit_log_target_idx").on(table.targetType, table.targetId, table.occurredAt),
  ],
);
