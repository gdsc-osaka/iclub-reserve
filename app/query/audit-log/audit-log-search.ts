import type { ResultAsync } from "neverthrow";

import type { AuditLogAction, AuditLogChanges, AuditLogTargetType } from "~/domain/audit-log";
import type { QueryError } from "../error";

/** 1 ページあたりの操作履歴表示件数 */
export const AUDIT_LOG_PAGE_SIZE = 50;

/** 操作履歴の検索条件 */
export interface AuditLogSearchFilter {
  readonly targetType: AuditLogTargetType | null;
  readonly groupId: string | null;
  readonly actorId: string | null;
  /** この時刻以降（含む）。null は下限なし */
  readonly occurredFrom: Date | null;
  /** この時刻より前（含まない）。null は上限なし */
  readonly occurredBefore: Date | null;
}

/** 1 件の操作履歴情報 */
export interface AuditLogSearchItem {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  /** 操作者名。ユーザーが退会・削除されていれば null */
  readonly actorName: string | null;
  readonly actedAsStaff: boolean;
  readonly action: AuditLogAction;
  readonly targetType: AuditLogTargetType;
  readonly targetId: string;
  readonly groupId: string | null;
  readonly groupName: string | null;
  /** 予約の記録のときだけ。予約の施設名と開始日時 */
  readonly reservation: { facilityName: string; startAt: Date } | null;
  /** 施設/設備の記録のときだけ。施設名 */
  readonly facilityName: string | null;
  /** 変更前・変更後の内容（パース済み） */
  readonly changes: AuditLogChanges;
}

/** 操作履歴の検索結果（1画面分） */
export interface AuditLogSearchResult {
  readonly items: readonly AuditLogSearchItem[];
  readonly hasNextPage: boolean;
  /** 絞り込みの選択肢: 全団体（名前の昇順） */
  readonly groups: readonly { id: string; name: string }[];
  /** 絞り込みの選択肢: 記録に一度でも現れた操作者（名前の昇順） */
  readonly actors: readonly { id: string; name: string }[];
  /** changes に現れる user_id の表示名（ID → 名前） */
  readonly userNames: Readonly<Record<string, string>>;
  /** changes に現れる facility_id の表示名（ID → 名前） */
  readonly facilityNames: Readonly<Record<string, string>>;
}

/**
 * 操作履歴の検索専用 Query ポート（ADR-001）。
 *
 * 画面 1 つ分に必要な記録、ページ送り情報、絞り込み選択肢、関連名称辞書を返す。
 */
export interface AuditLogSearchQuery {
  search(filter: AuditLogSearchFilter, page: number): ResultAsync<AuditLogSearchResult, QueryError>;
}
