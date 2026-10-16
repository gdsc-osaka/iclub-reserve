import { and, asc, eq, gt } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { groupInvitationTable, groupTable } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { normalizeInvitationEmail } from "~/domain/invitation/invitation-email";
import type { MembershipRole } from "~/domain/membership";
import type { Database } from "~/infra/db";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * ログインユーザー宛ての招待情報（ダッシュボード等で表示）。
 */
export interface UserInvitationItem {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly role: MembershipRole;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface FindUserInvitationsArgs {
  /** ログイン中のユーザーのメールアドレス（未正規化） */
  readonly actorEmail: string;
  readonly now: Date;
}

/**
 * ログインユーザー宛ての承諾待ち・期限内の招待一覧を取得する（UC-022）。
 *
 * 取得条件そのものが「本人のメールアドレス宛て」なので、他人の招待が混ざる余地がない。
 * メールアドレスは、小文字・前後空白除去に正規化してから問い合わせる。
 */
export const findUserInvitations = (
  db: Database,
  args: FindUserInvitationsArgs,
): ResultAsync<readonly UserInvitationItem[], QueryError> =>
  safeTry(async function* () {
    const normalizedEmail = normalizeInvitationEmail(args.actorEmail);

    const rows = yield* ResultAsync.fromPromise(
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
            gt(groupInvitationTable.expiresAt, args.now),
          ),
        )
        .orderBy(asc(groupInvitationTable.expiresAt), asc(groupInvitationTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "自分宛ての招待一覧の取得に失敗しました。",
        cause: error,
      }),
    );

    return ok(rows);
  });
