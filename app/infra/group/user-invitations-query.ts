import { and, asc, eq, gt } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { groupInvitationTable, groupTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { UserInvitationsQuery } from "~/query/group/user-invitations";
import type { Database } from "../db";

export const createUserInvitationsQuery = (db: Database): UserInvitationsQuery => ({
  findPendingInvitationsForEmail: (normalizedEmail: string, now: Date) => {
    return ResultAsync.fromPromise(
      db
        .select({
          id: groupInvitationTable.id,
          groupId: groupInvitationTable.groupId,
          groupName: groupTable.name,
          role: groupInvitationTable.role,
          expiresAt: groupInvitationTable.expiresAt,
          createdAt: groupInvitationTable.createdAt,
        })
        .from(groupInvitationTable)
        .innerJoin(groupTable, eq(groupTable.id, groupInvitationTable.groupId))
        .where(
          and(
            eq(groupInvitationTable.email, normalizedEmail),
            eq(groupInvitationTable.status, InvitationStatus.Pending),
            gt(groupInvitationTable.expiresAt, now),
          ),
        )
        .orderBy(asc(groupInvitationTable.expiresAt), asc(groupInvitationTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "自分宛ての招待一覧の取得に失敗しました。",
        cause: error,
      }),
    );
  },
});
