import { and, eq, exists, gt, gte, isNull, ne, not, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { ResultAsync } from "neverthrow";

import {
  auditLogTable,
  facilityTable,
  groupTable,
  reservationMessageTable,
  reservationReadTable,
  reservationTable,
} from "~/db/schema";
import { AuditLogTargetType } from "~/domain/audit-log";
import { unreadEventsSince } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  StaffUnreadMessageItem,
  StaffUnreadMessagesQuery,
  StaffUnreadMessagesResult,
} from "~/query/reservation/staff-unread-messages";
import type { Database } from "../db";
import { toUnreadRows } from "./unread-rows";

/** 団体側のメッセージより後の、事務局としてのメッセージを探すための別名 */
const laterStaffMessage = alias(reservationMessageTable, "later_staff_message");

/** 団体側のメッセージより後の、事務局権限による操作を探すための別名 */
const laterStaffAuditLog = alias(auditLogTable, "later_staff_audit_log");

export const createStaffUnreadMessagesQuery = (db: Database): StaffUnreadMessagesQuery => ({
  findUnreadForStaff: (staffUserId: string, now: Date) => {
    const since = unreadEventsSince(now);

    /*
     * 事務局側が最後に動いた日時より後のメッセージだけを未読にする（COND-026 (3)・(4)）。
     * 「最後に動いた日時」を求める代わりに、「このメッセージと同時か後に事務局側が動いていない」と
     * 言い換えて NOT EXISTS で書く。動いたのが事務局の誰であっても、全員の未読から消える。
     */
    const hasLaterStaffMessage = exists(
      db
        .select({ id: laterStaffMessage.id })
        .from(laterStaffMessage)
        .where(
          and(
            eq(laterStaffMessage.reservationId, reservationMessageTable.reservationId),
            eq(laterStaffMessage.sentAsStaff, true),
            gte(laterStaffMessage.sentAt, reservationMessageTable.sentAt),
          ),
        ),
    );

    const hasLaterStaffAuditLog = exists(
      db
        .select({ id: laterStaffAuditLog.id })
        .from(laterStaffAuditLog)
        .where(
          and(
            eq(laterStaffAuditLog.targetType, AuditLogTargetType.Reservation),
            eq(laterStaffAuditLog.targetId, reservationMessageTable.reservationId),
            eq(laterStaffAuditLog.actedAsStaff, true),
            gte(laterStaffAuditLog.occurredAt, reservationMessageTable.sentAt),
          ),
        ),
    );

    /** 本人のその予約の既読の記録（無ければ NULL） */
    const isOwnRead = and(
      eq(reservationReadTable.reservationId, reservationTable.id),
      eq(reservationReadTable.userId, staffUserId),
    );

    const query = db
      .select({
        reservationId: reservationTable.id,
        groupId: reservationTable.groupId,
        groupName: groupTable.name,
        facilityId: reservationTable.facilityId,
        facilityName: facilityTable.name,
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
        messageBody: reservationMessageTable.body,
        eventAt: reservationMessageTable.sentAt,
      })
      .from(reservationMessageTable)
      .innerJoin(reservationTable, eq(reservationTable.id, reservationMessageTable.reservationId))
      .innerJoin(groupTable, eq(groupTable.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .leftJoin(reservationReadTable, isOwnRead)
      .where(
        and(
          // 団体側のメッセージのみ（COND-026 (3)）
          eq(reservationMessageTable.sentAsStaff, false),
          // 事務局本人が団体側として送ったものは除く
          ne(reservationMessageTable.senderId, staffUserId),
          // 直近 30 日以内（COND-026 (6)）
          gt(reservationMessageTable.sentAt, since),
          // 本人の既読日時より後であること（開いただけなら本人の未読だけが消える）
          or(
            isNull(reservationReadTable.lastReadAt),
            gt(reservationMessageTable.sentAt, reservationReadTable.lastReadAt),
          ),
          // 事務局の誰かが後から返信、または承認などの操作をしていれば、全員の未読から消える
          not(hasLaterStaffMessage),
          not(hasLaterStaffAuditLog),
        ),
      );

    return ResultAsync.fromPromise(query, (error): QueryError => ({
      code: QueryErrorCode.DatabaseError,
      message: "事務局側の未読メッセージの取得に失敗しました。",
      cause: error,
    })).map((rows): StaffUnreadMessagesResult =>
      toUnreadRows(rows, (latest, otherCount): StaffUnreadMessageItem => ({
        reservationId: latest.reservationId,
        groupId: latest.groupId,
        groupName: latest.groupName,
        facilityId: latest.facilityId,
        facilityName: latest.facilityName,
        startAt: latest.startAt,
        endAt: latest.endAt,
        latestMessage: { body: latest.messageBody, sentAt: latest.eventAt },
        otherCount,
      })),
    );
  },
});
