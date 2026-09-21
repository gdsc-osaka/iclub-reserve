import { and, asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { invitation } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  GroupInvitationList,
  GroupInvitationListQuery,
} from "~/query/group/group-invitation-list";
import type { Database } from "../db";
import { toMembershipRoles } from "../membership/membership-converter";

/**
 * Cloudflare D1 (Drizzle) を使った GroupInvitationListQuery の実装。
 *
 * 承諾待ち（status = "pending"）の招待のみを取得する。
 * 期限切れの招待の除外は、Query ポートのシグネチャ（findByGroupId(groupId)）を維持し、
 * ADR-001 の責務分離を守るため、ここでは行わずユースケース側で行う。
 */
export const createGroupInvitationListQuery = (db: Database): GroupInvitationListQuery => ({
  findByGroupId: (groupId) =>
    ResultAsync.fromPromise(
      db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .where(and(eq(invitation.organizationId, groupId), eq(invitation.status, "pending")))
        /*
         * 期限が近い招待から順に確認できるよう、期限の昇順で並べる。
         * 同一期限の行の順序が安定するよう、ID を第 2 キーにする。
         */
        .orderBy(asc(invitation.expiresAt), asc(invitation.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "承諾待ちの招待一覧の取得に失敗しました。",
        cause: error,
      }),
    ).map((rows): GroupInvitationList =>
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        roles: toMembershipRoles(row.role ?? ""),
        expiresAt: row.expiresAt,
      })),
    ),
});
