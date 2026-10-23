import { and, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

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
import { wrapError } from "~/domain/error";
import { GroupUnreadEventType, unreadEventsSince } from "~/domain/reservation";
import type { Database } from "~/infra/db";
import { userQualifiesForReservationGroupAudience } from "~/infra/reservation/reservation-audience-condition";
import { toUnreadRows } from "~/infra/reservation/unread-rows";
import {
  reservationWithNamesColumns,
  type ReservationWithNames,
} from "../_shared/reservation-with-names";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 予約 1 件についての未読の出来事の代表（最新のもの）。
 */
export interface GroupUnreadLatestEvent {
  readonly type: GroupUnreadEventType;
  readonly eventAt: Date;
  readonly messageBody?: string | null;
  readonly statusReason?: string | null;
}

/**
 * ダッシュボード「確認が必要なこと」に並ぶ予約 1 行分のデータ（COND-026 (1)）。
 */
export interface GroupUnreadUpdateItem extends ReservationWithNames {
  readonly reservationId: string;
  /** 代表として出す最新の出来事 */
  readonly latestEvent: GroupUnreadLatestEvent;
  /** 代表以外の未読件数（COND-026 (1)「ほか n 件」） */
  readonly otherCount: number;
}

/**
 * 団体側の未読問い合わせ結果。
 */
export interface GroupUnreadUpdatesResult {
  /** 表示する最大 10 件の未読行（COND-026 (6)） */
  readonly items: readonly GroupUnreadUpdateItem[];
  /** 10 件を超えた予約の件数（超えた分は件数だけを示す） */
  readonly overflowCount: number;
  /**
   * 未読のある予約すべての ID（10 件を超えた分も含む）。
   *
   * 「すべて確認済みにする」で、画面から送られてきた ID が今も本人の未読かを確かめるのに使う。
   */
  readonly allUnreadReservationIds: readonly string[];
}

export interface FindGroupUnreadUpdatesArgs {
  readonly actorUserId: string;
  readonly now: Date;
}

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

interface RawEvent extends ReservationWithNames {
  reservationId: string;
  statusReason: string | null;
  type: GroupUnreadEventType;
  eventAt: Date;
  messageBody?: string | null;
}

/**
 * 団体側の「確認が必要なこと」に表示する未読の出来事一覧を取得する（UC-037 / COND-026）。
 *
 * 取得条件そのものが「本人が所属する団体の予約で、本人にとって未読のもの」なので、他人の分が混ざる余地がない。
 */
export const findGroupUnreadUpdates = (
  db: Database,
  args: FindGroupUnreadUpdatesArgs,
): ResultAsync<GroupUnreadUpdatesResult, QueryError> =>
  safeTry(async function* () {
    const { actorUserId: userId, now } = args;
    const since = unreadEventsSince(now);

    /** 行に出す予約の情報。メッセージと操作のどちらの問い合わせでも同じ列を取る */
    const reservationColumns = {
      reservationId: reservationTable.id,
      ...reservationWithNamesColumns,
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
    const [messageRows, auditLogRows] = yield* ResultAsync.fromPromise(
      Promise.all([messageQuery, auditLogQuery]),
      wrapError(QueryErrorCode.DatabaseError, "団体側の未読情報の取得に失敗しました。"),
    );

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

    return ok(
      toUnreadRows(allEvents, (latest, otherCount): GroupUnreadUpdateItem => ({
        reservationId: latest.reservationId,
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
        otherCount,
      })),
    );
  });

/**
 * 団体側の未読の Query ポート（ADR-012 決定 8）。
 *
 * 「すべて確認済みにする」（`mark-all-reservations-read.ts`）が、画面から送られてきた ID が本人の未読かを確かめるのに使う。
 */
export interface GroupUnreadUpdatesQuery {
  /**
   * 団体側の未読を一覧取得する（COND-026）。
   */
  findUnreadForUser(userId: string, now: Date): ResultAsync<GroupUnreadUpdatesResult, QueryError>;
}

export const createGroupUnreadUpdatesQuery = (db: Database): GroupUnreadUpdatesQuery => ({
  findUnreadForUser: (userId, now) => findGroupUnreadUpdates(db, { actorUserId: userId, now }),
});
