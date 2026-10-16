import { and, eq, exists, gt, gte, isNull, ne, not, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { ok, ResultAsync, safeTry } from "neverthrow";

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
import type { Database } from "~/infra/db";
import { toUnreadRows } from "~/infra/reservation/unread-rows";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局側で未読として表示するメッセージ 1 件分の要約。
 */
export interface StaffUnreadLatestMessage {
  readonly body: string;
  readonly sentAt: Date;
}

/**
 * ダッシュボード「団体からの未読メッセージ」に並ぶ予約 1 行分のデータ（COND-026 (1)・(3)）。
 */
export interface StaffUnreadMessageItem {
  readonly reservationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /** 代表として出す最新のメッセージ */
  readonly latestMessage: StaffUnreadLatestMessage;
  /** 代表以外の未読件数（COND-026 (1)「ほか n 件」） */
  readonly otherCount: number;
}

/**
 * 「団体からの未読メッセージ」1 区画分。
 */
export interface StaffUnreadMessages {
  /** 表示する最大 10 件の未読行（COND-026 (6)） */
  readonly items: readonly StaffUnreadMessageItem[];
  /** 10 件を超えた予約の件数 */
  readonly overflowCount: number;
  /**
   * 未読のある予約すべての ID（10 件を超えた分も含む）。
   */
  readonly allUnreadReservationIds: readonly string[];
}

export interface FindStaffUnreadMessagesArgs {
  /** 見ている事務局。既読の記録はこの人の分を見る */
  readonly actorUserId: string;
  /** 事務局かどうか（COND-009）。全団体のメッセージを見るので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

/** 団体側のメッセージより後の、事務局としてのメッセージを探すための別名 */
const laterStaffMessage = alias(reservationMessageTable, "later_staff_message");

/** 団体側のメッセージより後の、事務局権限による操作を探すための別名 */
const laterStaffAuditLog = alias(auditLogTable, "later_staff_audit_log");

/**
 * 事務局のダッシュボードの「団体からの未読メッセージ」を取得する（UC-037 / COND-026 (3)）。
 */
export const findStaffUnreadMessages = (
  db: Database,
  args: FindStaffUnreadMessagesArgs,
): ResultAsync<StaffUnreadMessages, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(
      args.isStaff,
      "事務局ではない人が、事務局向けの未読メッセージを取得しようとした。",
    );

    const since = unreadEventsSince(args.now);

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
      eq(reservationReadTable.userId, args.actorUserId),
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
          ne(reservationMessageTable.senderId, args.actorUserId),
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

    const rows = yield* ResultAsync.fromPromise(query, (error): QueryError => ({
      code: QueryErrorCode.DatabaseError,
      message: "事務局側の未読メッセージの取得に失敗しました。",
      cause: error,
    }));

    return ok(
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
  });
