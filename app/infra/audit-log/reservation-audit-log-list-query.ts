import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { auditLogTable, facilityTable, user } from "~/db/schema";
import { AuditLogTargetType, parseAuditLogChanges } from "~/domain/audit-log";
import { QueryErrorCode, type QueryError } from "~/query/error";
import {
  RESERVATION_AUDIT_LOG_PAGE_SIZE,
  type ReservationAuditLogItem,
  type ReservationAuditLogList,
  type ReservationAuditLogListQuery,
} from "~/query/audit-log/reservation-audit-log-list";
import type { Database } from "../db";
import { collectIds } from "./collect-ids";

const findReservationAuditLogs = async (
  db: Database,
  reservationId: string,
  page: number,
): Promise<ReservationAuditLogList> => {
  const offset = (Math.max(1, page) - 1) * RESERVATION_AUDIT_LOG_PAGE_SIZE;

  // 1. 記録本体の取得
  const logRows = await db
    .select({
      id: auditLogTable.id,
      occurredAt: auditLogTable.occurredAt,
      // 他の操作履歴の Query とそろえて、名前の列には別名を付ける（db.batch に入れても列がずれないように）
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
        eq(auditLogTable.targetType, AuditLogTargetType.Reservation),
        eq(auditLogTable.targetId, reservationId),
      ),
    )
    .orderBy(desc(auditLogTable.occurredAt), desc(auditLogTable.id))
    .limit(RESERVATION_AUDIT_LOG_PAGE_SIZE + 1)
    .offset(offset);

  const hasNextPage = logRows.length > RESERVATION_AUDIT_LOG_PAGE_SIZE;

  const userIds = new Set<string>();
  const facilityIds = new Set<string>();

  const items = logRows
    .slice(0, RESERVATION_AUDIT_LOG_PAGE_SIZE)
    .map((row): ReservationAuditLogItem => {
      const changes = parseAuditLogChanges(row.changes);
      collectIds(changes, "user_id", userIds);
      collectIds(changes, "facility_id", facilityIds);

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

  const result: ReservationAuditLogList = {
    items,
    hasNextPage,
    userNames: {},
    facilityNames: {},
  };

  if (userIds.size === 0 && facilityIds.size === 0) {
    return result;
  }

  // changes に出てくる人と施設の名前を、1 回の往復（db.batch）でまとめて引く（N+1 にしない）
  const [userRows, facilityRows] = await db.batch([
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...userIds])),
    db
      .select({ id: facilityTable.id, name: facilityTable.name })
      .from(facilityTable)
      .where(inArray(facilityTable.id, [...facilityIds])),
  ]);

  return {
    ...result,
    userNames: Object.fromEntries(userRows.map((row) => [row.id, row.name])),
    facilityNames: Object.fromEntries(facilityRows.map((row) => [row.id, row.name])),
  };
};

/**
 * Cloudflare D1 (Drizzle) を使った ReservationAuditLogListQuery の実装。
 *
 * 予約（reservation）に関する操作履歴を新しい順にページネーション付きで取得する。
 */
export const createReservationAuditLogListQuery = (db: Database): ReservationAuditLogListQuery => ({
  findByReservationId: (
    reservationId: string,
    page: number,
  ): ResultAsync<ReservationAuditLogList, QueryError> =>
    ResultAsync.fromPromise(
      findReservationAuditLogs(db, reservationId, page),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "予約の操作履歴を読み取れなかった。",
        cause: error,
      }),
    ),
});
