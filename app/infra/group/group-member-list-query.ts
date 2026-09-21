import { asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { member, user } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { GroupMemberList, GroupMemberListQuery } from "~/query/group/group-member-list";
import type { Database } from "../db";
import { toMembershipRoles } from "../membership/membership-converter";

/**
 * Cloudflare D1 (Drizzle) を使った GroupMemberListQuery の実装。
 *
 * member と user を 1 回の問い合わせで innerJoin する。
 * 「所属している member を引いてから 1 人ずつ user を引く」書き方にすると、
 * メンバーの人数分だけ DB へのネットワーク往復が増加する（N+1 問題）。
 * Cloudflare D1 は 1 クエリごとにネットワーク往復が発生するため、
 * 画面用のデータ取得は必ず SQL 結合を使って 1 回で取得する。
 */
export const createGroupMemberListQuery = (db: Database): GroupMemberListQuery => ({
  findByGroupId: (groupId) =>
    ResultAsync.fromPromise(
      db
        .select({
          memberId: member.id,
          userId: member.userId,
          name: user.name,
          email: user.email,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, groupId))
        /*
         * 同名ユーザーがいても再読み込みで並び順が入れ替わらないよう、
         * ユーザー名の昇順を第 1 キー、member テーブルの ID 昇順を第 2 キーにして固定する。
         */
        .orderBy(asc(user.name), asc(member.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "団体メンバー一覧の取得に失敗しました。",
        cause: error,
      }),
    ).map((rows): GroupMemberList =>
      rows.map((row) => ({
        memberId: row.memberId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        roles: toMembershipRoles(row.role),
      })),
    ),
});
