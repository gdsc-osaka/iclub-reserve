import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { err, ok, ResultAsync } from "neverthrow";
import { member, reservationTable, user } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationMailRecipient,
  ReservationMailRecipients,
  ReservationMailRecipientsQuery,
} from "~/query/reservation/reservation-mail-recipients";
import type { Database } from "../db";
import { toMembershipRoles } from "../membership/membership-converter";

const applicantUser = alias(user, "applicant_user");

/**
 * Cloudflare D1 (Drizzle) を使った ReservationMailRecipientsQuery の実装。
 *
 * 予約（reservation）、申請者（user）、および団体の管理者メンバー（member × user）を
 * 1 回の問い合わせで取得する。
 * D1 は 1 クエリごとにネットワーク往復が発生するため、N+1 を避けて結合で取得する。
 */
export const createReservationMailRecipientsQuery = (
  db: Database,
): ReservationMailRecipientsQuery => ({
  findByReservationId: (reservationId: string) =>
    ResultAsync.fromPromise(
      db
        .select({
          reservationId: reservationTable.id,
          applicantId: applicantUser.id,
          applicantEmail: applicantUser.email,
          applicantName: applicantUser.name,
          memberUserId: user.id,
          memberEmail: user.email,
          memberName: user.name,
          memberRole: member.role,
        })
        .from(reservationTable)
        .leftJoin(applicantUser, eq(reservationTable.createdBy, applicantUser.id))
        .leftJoin(member, eq(member.organizationId, reservationTable.groupId))
        .leftJoin(user, eq(user.id, member.userId))
        .where(eq(reservationTable.id, reservationId))
        .orderBy(asc(user.email)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "予約通知先アドレスの取得に失敗しました。",
        cause: error,
      }),
    ).andThen((rows) => {
      if (rows.length === 0) {
        return err<ReservationMailRecipients, QueryError>({
          code: QueryErrorCode.NotFound,
          message: `ID が ${reservationId} の予約は見つかりませんでした。`,
        });
      }

      const recipientsMap = new Map<string, ReservationMailRecipient>();

      // 1. 申請者を追加（createdBy が null の場合は applicantEmail が null になる）
      const firstRow = rows[0]!;
      if (firstRow.applicantEmail) {
        recipientsMap.set(firstRow.applicantEmail, {
          userId: firstRow.applicantId ?? undefined,
          address: firstRow.applicantEmail,
          name: firstRow.applicantName,
        });
      }

      // 2. 団体の管理者メンバーを追加
      for (const row of rows) {
        if (!row.memberEmail || !row.memberRole) continue;

        const roles = toMembershipRoles(row.memberRole);
        if (roles.includes(MembershipRole.Admin)) {
          // すでに申請者として追加されている場合は重複させない
          if (!recipientsMap.has(row.memberEmail)) {
            recipientsMap.set(row.memberEmail, {
              userId: row.memberUserId ?? undefined,
              address: row.memberEmail,
              name: row.memberName,
            });
          }
        }
      }

      const sortedRecipients = Array.from(recipientsMap.values()).sort((a, b) =>
        a.address.localeCompare(b.address),
      );

      return ok<ReservationMailRecipients, QueryError>(sortedRecipients);
    }),
});
