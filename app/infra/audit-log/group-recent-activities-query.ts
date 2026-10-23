import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";

import { auditLogTable, facilityTable, groupTable, reservationTable, user } from "~/db/schema";
import {
  AuditLogTargetType,
  parseAuditLogChanges,
  visibleAuditLogTargetTypesForRole,
} from "~/domain/audit-log";
import { wrapError } from "~/domain/error";
import { MembershipRole } from "~/domain/membership";
import type {
  FindRecentGroupActivitiesArgs,
  GroupRecentActivitiesQuery,
  GroupRecentActivityItem,
} from "~/query/audit-log/group-recent-activities";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { Database } from "../db";

const findRecentActivities = async (
  db: Database,
  args: FindRecentGroupActivitiesArgs,
): Promise<readonly GroupRecentActivityItem[]> => {
  // 役割ごとに、その役割で所属している団体の、見せてよい種類の記録に絞る（COND-012 (2)・(3)）
  const visibleByRole = Object.values(MembershipRole).flatMap((role) => {
    const groupIds = args.groups.filter((group) => group.role === role).map((group) => group.id);
    if (groupIds.length === 0) {
      return [];
    }
    return [
      and(
        inArray(auditLogTable.groupId, groupIds),
        inArray(auditLogTable.targetType, [...visibleAuditLogTargetTypesForRole(role)]),
      ),
    ];
  });

  const rows = await db
    .select({
      id: auditLogTable.id,
      occurredAt: auditLogTable.occurredAt,
      actorName: user.name,
      actedAsStaff: auditLogTable.actedAsStaff,
      action: auditLogTable.action,
      targetType: auditLogTable.targetType,
      targetId: auditLogTable.targetId,
      groupId: groupTable.id,
      groupName: groupTable.name,
      facilityName: facilityTable.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      changes: auditLogTable.changes,
    })
    .from(auditLogTable)
    .innerJoin(groupTable, eq(groupTable.id, auditLogTable.groupId))
    .leftJoin(user, eq(user.id, auditLogTable.actorId))
    .leftJoin(
      reservationTable,
      and(
        eq(auditLogTable.targetType, AuditLogTargetType.Reservation),
        eq(reservationTable.id, auditLogTable.targetId),
      ),
    )
    .leftJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
    .where(
      and(
        or(...visibleByRole),
        gte(auditLogTable.occurredAt, args.since),
        // 本人がした操作は、本人が知っているので出さない
        ne(auditLogTable.actorId, args.actorUserId),
        // 予約に対する事務局の横断権限による操作は「確認が必要なこと」に出るので除く（COND-026）。
        // 予約以外（団体・メンバーシップ・招待）への事務局の操作は未読に出ないので残す
        or(
          ne(auditLogTable.targetType, AuditLogTargetType.Reservation),
          eq(auditLogTable.actedAsStaff, false),
        ),
      ),
    )
    .orderBy(desc(auditLogTable.occurredAt), desc(auditLogTable.id))
    .limit(args.limit);

  return rows.map(({ facilityName, startAt, endAt, changes, ...row }): GroupRecentActivityItem => ({
    ...row,
    reservation:
      facilityName !== null && startAt !== null && endAt !== null
        ? { facilityName, startAt, endAt }
        : null,
    changes: parseAuditLogChanges(changes),
  }));
};

/**
 * Cloudflare D1 (Drizzle) を使った GroupRecentActivitiesQuery の実装。
 *
 * 予約の記録には、行に施設名と日時を出すために予約と施設を結合する（1 回の問い合わせで取る）。
 */
export const createGroupRecentActivitiesQuery = (db: Database): GroupRecentActivitiesQuery => ({
  findRecentActivities: (
    args: FindRecentGroupActivitiesArgs,
  ): ResultAsync<readonly GroupRecentActivityItem[], QueryError> => {
    // 所属が無ければ見せてよい記録も無いので、問い合わせない
    if (args.groups.length === 0) {
      return okAsync([]);
    }

    return ResultAsync.fromPromise(
      findRecentActivities(db, args),
      wrapError(QueryErrorCode.DatabaseError, "団体の最近の動きを読み取れなかった。"),
    );
  },
});
