import type { ResultAsync } from "neverthrow";

import type { AuditLogAction, AuditLogChanges, AuditLogTargetType } from "~/domain/audit-log";
import type { QueryError } from "../error";

/** 1 ページあたりの団体操作履歴表示件数 */
export const GROUP_AUDIT_LOG_PAGE_SIZE = 20;

/** 1 件の団体操作履歴情報 */
export interface GroupAuditLogItem {
  readonly id: string;
  readonly occurredAt: Date;
  /** 操作者名。ユーザーが退会・削除されていれば null */
  readonly actorName: string | null;
  readonly actedAsStaff: boolean;
  readonly action: AuditLogAction;
  readonly targetType: AuditLogTargetType;
  readonly targetId: string;
  /** 変更前・変更後の内容（パース済み） */
  readonly changes: AuditLogChanges;
}

/** 団体操作履歴の取得結果（1画面分） */
export interface GroupAuditLogList {
  readonly items: readonly GroupAuditLogItem[];
  readonly hasNextPage: boolean;
  /** changes に現れる user_id の表示名（ID → 名前） */
  readonly userNames: Readonly<Record<string, string>>;
}

/**
 * 団体操作履歴の取得専用 Query ポート（ADR-001）。
 *
 * 団体管理画面（SCR-007）の操作履歴欄に必要な記録、ページ送り情報、関連名称辞書を返す。
 */
export interface GroupAuditLogListQuery {
  findByGroupId(groupId: string, page: number): ResultAsync<GroupAuditLogList, QueryError>;
}
