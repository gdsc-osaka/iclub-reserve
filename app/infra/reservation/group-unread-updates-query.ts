import { and, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
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
import { UNREAD_ITEMS_LIMIT, unreadEventsSince } from "~/domain/reservation";
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
    const since = unreadEventsSince(now);

    /** 行に出す予約の情報。メッセージと操作のどちらの問い合わせでも同じ列を取る */
    const reservationColumns = {
      reservationId: reservationTable.id,
      groupId: reservationTable.groupId,
      groupName: groupTable.name,
      facilityId: reservationTable.facilityId,
      facilityName: facilityTable.name,
      startAt: reservationTable.startAt,
      endAt: reservationTable.endAt,
      statusReason: reservationTable.statusReason,
    };

    /** 本人が予約の団体の今のメンバーであること（COND-008 の (1)）。外れた人は内部結合で落ちる */
    const isCurrentMember = and(
      eq(groupMemberTable.groupId, reservationTable.groupId),
      eq(groupMemberTable.userId, userId),
    );

    /** 本人のその予約の既読の記録（無ければ列は NULL になる） */
    const isOwnRead = and(
      eq(reservationReadTable.reservationId, reservationTable.id),
      eq(reservationReadTable.userId, userId),
    );

    /**
     * 本人にとって未読の出来事であること（COND-026 (2)・(4)・(6)）。
     *
     * 直近 30 日より後で、既読の日時より後（既読の記録が無ければ 30 日の起点だけで決める）、
     * かつ本人が申請者・管理者・団体側として送ったことのある人のいずれかであること。
     */
    const isUnreadEvent = (
      eventAt: typeof reservationMessageTable.sentAt | typeof auditLogTable.occurredAt,
    ) =>
      and(
        gt(eventAt, since),
        or(isNull(reservationReadTable.lastReadAt), gt(eventAt, reservationReadTable.lastReadAt)),
        userQualifiesForReservationGroupAudience(db, userId),
      );

    // 事務局としてのメッセージ（本人が送ったものは除く）
    const messageQuery = db
      .select({
        ...reservationColumns,
        messageBody: reservationMessageTable.body,
        eventAt: reservationMessageTable.sentAt,
      })
      .from(reservationMessageTable)
      .innerJoin(reservationTable, eq(reservationTable.id, reservationMessageTable.reservationId))
      .innerJoin(groupTable, eq(groupTable.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .innerJoin(groupMemberTable, isCurrentMember)
      .leftJoin(reservationReadTable, isOwnRead)
      .where(
        and(
          eq(reservationMessageTable.sentAsStaff, true),
          ne(reservationMessageTable.senderId, userId),
          isUnreadEvent(reservationMessageTable.sentAt),
        ),
      );

    // 事務局権限による予約の操作（本人がしたものは除く）
    const auditLogQuery = db
      .select({
        ...reservationColumns,
        action: auditLogTable.action,
        eventAt: auditLogTable.occurredAt,
      })
      .from(auditLogTable)
      .innerJoin(reservationTable, eq(reservationTable.id, auditLogTable.targetId))
      .innerJoin(groupTable, eq(groupTable.id, reservationTable.groupId))
      .innerJoin(facilityTable, eq(facilityTable.id, reservationTable.facilityId))
      .innerJoin(groupMemberTable, isCurrentMember)
      .leftJoin(reservationReadTable, isOwnRead)
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
          isUnreadEvent(auditLogTable.occurredAt),
        ),
      );

    /*
     * db.batch() ではなく、2 つを並べて投げる。
     * D1 の db.batch() は 1 行を「列名 → 値」で受け取るので、同じ名前の列（団体と施設の name）が潰れてしまい、
     * 列に別名を付ける SQL を書かなければならなくなるため。
     */
    return ResultAsync.fromPromise(
      Promise.all([messageQuery, auditLogQuery]),
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
      const items = reservationItems.slice(0, UNREAD_ITEMS_LIMIT);
      const overflowCount = Math.max(0, reservationItems.length - UNREAD_ITEMS_LIMIT);

      return {
        items,
        overflowCount,
        allUnreadReservationIds,
      };
    });
  },
});
