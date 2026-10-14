import { and, eq, exists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { groupMemberTable, reservationMessageTable, reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import type { Database } from "../db";

/**
 * 「団体側として送ったメッセージがあるか」を探すとき、メッセージの表をもう一度読むための別名。
 *
 * 外側の問い合わせもメッセージの表を読むことがあるので、名前を分けてどちらの行かをはっきりさせる。
 */
const groupSideMessage = alias(reservationMessageTable, "group_side_message");

/**
 * ユーザーがその予約の団体側の未読の対象者（申請者・管理者・団体側として送ったことのある人）であるかの条件を組み立てる（COND-026 (2) / EVT-008）。
 *
 * 前提: reservationTable と、groupId と userId で結合した groupMemberTable が外側の問い合わせにあること。
 */
export const userQualifiesForReservationGroupAudience = (db: Database, userId: string) =>
  or(
    eq(reservationTable.createdBy, userId),
    eq(groupMemberTable.role, MembershipRole.Admin),
    exists(
      db
        .select({ id: groupSideMessage.id })
        .from(groupSideMessage)
        .where(
          and(
            eq(groupSideMessage.reservationId, reservationTable.id),
            eq(groupSideMessage.senderId, userId),
            eq(groupSideMessage.sentAsStaff, false),
          ),
        ),
    ),
  );
