import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import {
  auditLogTable,
  facilityTable,
  groupMemberTable,
  groupTable,
  reservationMessageTable,
  reservationReadTable,
  reservationTable,
} from "~/db/schema";
import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { UNREAD_TRACKING_STARTS_AT } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import {
  GroupUnreadEventType,
  type GroupUnreadUpdateItem,
  type GroupUnreadUpdatesQuery,
  type GroupUnreadUpdatesResult,
} from "~/query/reservation/group-unread-updates";
import type { Database } from "../db";
import { userQualifiesForReservationGroupAudience } from "./reservation-audience-condition";

const auditActionToUnreadEventType = (action: AuditLogAction): GroupUnreadEventType => {
  switch (action) {
    case AuditLogAction.ReservationApprove:
      return GroupUnreadEventType.Approve;
    case AuditLogAction.ReservationReject:
      return GroupUnreadEventType.Reject;
    case AuditLogAction.ReservationStaffCancel:
      return GroupUnreadEventType.StaffCancel;
    case AuditLogAction.ReservationDirectCreate:
      return GroupUnreadEventType.DirectCreate;
    case AuditLogAction.ReservationDirectChange:
      return GroupUnreadEventType.DirectChange;
    default:
      return GroupUnreadEventType.Message;
  }
};

interface RawEvent {
  reservationId: string;
  groupId: string;
  groupName: string;
  facilityId: string;
  facilityName: string;
  startAt: Date;
  endAt: Date;
  statusReason: string | null;
  type: GroupUnreadEventType;
  eventAt: Date;
  messageBody?: string | null;
}

export const createGroupUnreadUpdatesQuery = (db: Database): GroupUnreadUpdatesQuery => ({
  findUnreadForUser: (userId: string, now: Date) => {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const minThreshold = new Date(
      Math.max(thirtyDaysAgo.getTime(), UNREAD_TRACKING_STARTS_AT.getTime()),
    );

    /*
     * D1 の db.batch() は各行を「列名 → 値」の辞書として受け取るため、
     * 同じ名前の列（name や id）が 2 つあると値が衝突して上書きされる。
     * そのため、reservationTable.id のみを id として残し、name には別名を付ける。
     */
    const messageQuery = db
      .select({
        reservationId: reservationTable.id,
        groupId: reservationTable.groupId,
        groupName: sql<string>`${groupTable.name}`.as("group_name"),
        facilityId: reservationTable.facilityId,
        facilityName: sql<string>`${facilityTable.name}`.as("facility_name"),
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
        statusReason: reservationTable.statusReason,
        messageBody: reservationMessageTable.body,
        eventAt: reservationMessageTable.sentAt,
      })
      .from(reservationMessageTable)
      .innerJoin(reservationTable, eq(reservationTable.id, reservationMessageTable.reservationId))
      .innerJoin(groupTable, eq(groupTable.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .innerJoin(
        groupMemberTable,
        and(
          eq(groupMemberTable.groupId, reservationTable.groupId),
          eq(groupMemberTable.userId, userId),
        ),
      )
      .leftJoin(
        reservationReadTable,
        and(
          eq(reservationReadTable.reservationId, reservationTable.id),
          eq(reservationReadTable.userId, userId),
        ),
      )
      .where(
        and(
          eq(reservationMessageTable.sentAsStaff, true),
          ne(reservationMessageTable.senderId, userId),
          gt(reservationMessageTable.sentAt, minThreshold),
          or(
            isNull(reservationReadTable.lastReadAt),
            gt(reservationMessageTable.sentAt, reservationReadTable.lastReadAt),
          ),
          userQualifiesForReservationGroupAudience(userId),
        ),
      );

    const auditLogQuery = db
      .select({
        reservationId: reservationTable.id,
        groupId: reservationTable.groupId,
        groupName: sql<string>`${groupTable.name}`.as("audit_group_name"),
        facilityId: reservationTable.facilityId,
        facilityName: sql<string>`${facilityTable.name}`.as("audit_facility_name"),
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
        statusReason: reservationTable.statusReason,
        action: auditLogTable.action,
        eventAt: auditLogTable.occurredAt,
      })
      .from(auditLogTable)
      .innerJoin(reservationTable, eq(reservationTable.id, auditLogTable.targetId))
      .innerJoin(groupTable, eq(groupTable.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .innerJoin(
        groupMemberTable,
        and(
          eq(groupMemberTable.groupId, reservationTable.groupId),
          eq(groupMemberTable.userId, userId),
        ),
      )
      .leftJoin(
        reservationReadTable,
        and(
          eq(reservationReadTable.reservationId, reservationTable.id),
          eq(reservationReadTable.userId, userId),
        ),
      )
      .where(
        and(
          eq(auditLogTable.targetType, AuditLogTargetType.Reservation),
          eq(auditLogTable.actedAsStaff, true),
          ne(auditLogTable.actorId, userId),
          inArray(auditLogTable.action, [
            AuditLogAction.ReservationApprove,
            AuditLogAction.ReservationReject,
            AuditLogAction.ReservationStaffCancel,
            AuditLogAction.ReservationDirectCreate,
            AuditLogAction.ReservationDirectChange,
          ]),
          gt(auditLogTable.occurredAt, minThreshold),
          or(
            isNull(reservationReadTable.lastReadAt),
            gt(auditLogTable.occurredAt, reservationReadTable.lastReadAt),
          ),
          userQualifiesForReservationGroupAudience(userId),
        ),
      );

    return ResultAsync.fromPromise(
      db.batch([messageQuery, auditLogQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "団体側の未読情報の取得に失敗しました。",
        cause: error,
      }),
    ).map(([messageRows, auditLogRows]): GroupUnreadUpdatesResult => {
      const allEvents: RawEvent[] = [
        ...messageRows.map((row): RawEvent => ({
          reservationId: row.reservationId,
          groupId: row.groupId,
          groupName: row.groupName,
          facilityId: row.facilityId,
          facilityName: row.facilityName,
          startAt: row.startAt,
          endAt: row.endAt,
          statusReason: row.statusReason,
          type: GroupUnreadEventType.Message,
          eventAt: row.eventAt,
          messageBody: row.messageBody,
        })),
        ...auditLogRows.map((row): RawEvent => ({
          reservationId: row.reservationId,
          groupId: row.groupId,
          groupName: row.groupName,
          facilityId: row.facilityId,
          facilityName: row.facilityName,
          startAt: row.startAt,
          endAt: row.endAt,
          statusReason: row.statusReason,
          type: auditActionToUnreadEventType(row.action),
          eventAt: row.eventAt,
          messageBody: null,
        })),
      ];

      // 予約ごとにイベントをグループ化
      const eventsByReservation = new Map<string, RawEvent[]>();
      for (const event of allEvents) {
        const list = eventsByReservation.get(event.reservationId) ?? [];
        list.push(event);
        eventsByReservation.set(event.reservationId, list);
      }

      // 各予約のイベントを新しい順にソートし、最新のものを代表として 1 行にまとめる
      const reservationItems: GroupUnreadUpdateItem[] = [];
      for (const [reservationId, events] of eventsByReservation) {
        events.sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());
        const latest = events[0];
        if (!latest) continue;

        reservationItems.push({
          reservationId,
          groupId: latest.groupId,
          groupName: latest.groupName,
          facilityId: latest.facilityId,
          facilityName: latest.facilityName,
          startAt: latest.startAt,
          endAt: latest.endAt,
          latestEvent: {
            type: latest.type,
            eventAt: latest.eventAt,
            messageBody: latest.messageBody,
            statusReason: latest.statusReason,
          },
          otherCount: events.length - 1,
        });
      }

      // 最新イベントの日時が新しい順にソート
      reservationItems.sort(
        (a, b) => b.latestEvent.eventAt.getTime() - a.latestEvent.eventAt.getTime(),
      );

      const allUnreadReservationIds = reservationItems.map((item) => item.reservationId);
      const items = reservationItems.slice(0, 10);
      const overflowCount = Math.max(0, reservationItems.length - 10);

      return {
        items,
        overflowCount,
        allUnreadReservationIds,
      };
    });
  },
});
