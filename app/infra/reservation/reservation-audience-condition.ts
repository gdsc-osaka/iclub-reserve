import { eq, or, sql } from "drizzle-orm";
import { groupMemberTable, reservationMessageTable, reservationTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";

/**
 * ユーザーがその予約の団体側通知・未読対象者（申請者、管理者、過去の団体側送信者）であるかの SQL 条件を組み立てる（COND-026 (2) / EVT-008）。
 *
 * 前提: reservationTable および groupMemberTable（groupId と userId で結合済み）が存在すること。
 */
export const userQualifiesForReservationGroupAudience = (userId: string) =>
  or(
    eq(reservationTable.createdBy, userId),
    eq(groupMemberTable.role, MembershipRole.Admin),
    sql`EXISTS (
      SELECT 1 FROM ${reservationMessageTable} rm
      WHERE rm.reservation_id = ${reservationTable.id}
        AND rm.sender_id = ${userId}
        AND rm.sent_as_staff = 0
    )`,
  );
