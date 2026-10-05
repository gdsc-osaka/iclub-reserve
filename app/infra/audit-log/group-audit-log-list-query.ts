import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { auditLogTable, user } from "~/db/schema";
import { AuditLogTargetType, parseAuditLogChanges } from "~/domain/audit-log";
import { QueryErrorCode, type QueryError } from "~/query/error";
import {
  GROUP_AUDIT_LOG_PAGE_SIZE,
  type GroupAuditLogItem,
  type GroupAuditLogList,
  type GroupAuditLogListQuery,
} from "~/query/audit-log/group-audit-log-list";
import type { Database } from "../db";
import { collectIds } from "./collect-ids";

const GROUP_AUDIT_LOG_TARGET_TYPES = [
  AuditLogTargetType.Group,
  AuditLogTargetType.Membership,
  AuditLogTargetType.Invitation,
] as const;

const findGroupAuditLogs = async (
  db: Database,
  groupId: string,
  page: number,
): Promise<GroupAuditLogList> => {
  const offset = (Math.max(1, page) - 1) * GROUP_AUDIT_LOG_PAGE_SIZE;

  // 1. 記録本体の取得
  const logRows = await db
    .select({
      id: auditLogTable.id,
      occurredAt: auditLogTable.occurredAt,
      actorName: sql<string | null>`${user.name}`.as("actor_name"),
      actedAsStaff: auditLogTable.actedAsStaff,
      action: auditLogTable.action,
      targetType: auditLogTable.targetType,
      targetId: auditLogTable.targetId,
      changes: auditLogTable.changes,
    })
    .from(auditLogTable)
    .leftJoin(user, eq(user.id, auditLogTable.actorId))
    .where(
      and(
        eq(auditLogTable.groupId, groupId),
        inArray(auditLogTable.targetType, [...GROUP_AUDIT_LOG_TARGET_TYPES]),
      ),
    )
    .orderBy(desc(auditLogTable.occurredAt), desc(auditLogTable.id))
    .limit(GROUP_AUDIT_LOG_PAGE_SIZE + 1)
    .offset(offset);

  const hasNextPage = logRows.length > GROUP_AUDIT_LOG_PAGE_SIZE;

  const userIds = new Set<string>();

  const items = logRows.slice(0, GROUP_AUDIT_LOG_PAGE_SIZE).map((row): GroupAuditLogItem => {
    const changes = parseAuditLogChanges(row.changes);
    collectIds(changes, "user_id", userIds);

    return {
      id: row.id,
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      actedAsStaff: row.actedAsStaff,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      changes,
    };
  });

  const result: GroupAuditLogList = {
    items,
    hasNextPage,
    userNames: {},
  };

  if (userIds.size === 0) {
    return result;
  }

  // changes に出てくるユーザーの名前をまとめて引く（N+1 を防ぐ）
  const userRows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...userIds]));

  return {
    ...result,
    userNames: Object.fromEntries(userRows.map((row) => [row.id, row.name])),
  };
};

/**
 * Cloudflare D1 (Drizzle) を使った GroupAuditLogListQuery の実装。
 *
 * 団体（group）・メンバーシップ（membership）・招待（invitation）に関する
 * 操作履歴を新しい順にページネーション付きで取得する。
 */
export const createGroupAuditLogListQuery = (db: Database): GroupAuditLogListQuery => ({
  findByGroupId: (groupId: string, page: number): ResultAsync<GroupAuditLogList, QueryError> =>
    ResultAsync.fromPromise(findGroupAuditLogs(db, groupId, page), (error): QueryError => ({
      code: QueryErrorCode.DatabaseError,
      message: "団体操作履歴を読み取れなかった。",
      cause: error,
    })),
});
