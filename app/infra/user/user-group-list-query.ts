import { asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { groupMemberTable, groupTable } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import type { Database } from "../db";
import { toMembershipRole } from "../membership/membership-converter";

/**
 * Cloudflare D1 (Drizzle) を使った UserGroupListQuery の実装。
 *
 * groupMemberTable と groupTable を 1 回の問い合わせで結合する。
 * 「所属している ID を引いてから 1 件ずつ団体を引く」書き方にすると、
 * 所属している団体の数だけ DB アクセスが増える (N+1 問題)。
 * D1 は 1 クエリごとにネットワーク往復が入るので、ここは必ず結合で取る。
 *
 * 所属が 0 件のときに空の配列を返せばよいので、leftJoin ではなく innerJoin でよい。
 * 「ユーザーが存在するのに 0 件」と「ユーザーが存在しない」を
 * この画面で区別する必要がないため。
 */
export const createUserGroupListQuery = (db: Database): UserGroupListQuery => ({
  findByUserId: (userId) =>
    ResultAsync.fromPromise(
      db
        .select({
          id: groupTable.id,
          name: groupTable.name,
          status: groupTable.status,
          role: groupMemberTable.role,
        })
        .from(groupMemberTable)
        .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
        .where(eq(groupMemberTable.userId, userId))
        /*
         * 同名の団体があっても並びが入れ替わらないよう、主キーを第 2 キーにする。
         * 団体名には一意制約がなく、名前だけで並べると同名どうしの順序を SQL が保証しない。
         */
        .orderBy(asc(groupTable.name), asc(groupTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "所属している団体の取得に失敗しました。",
        cause: error,
      }),
    ).map((rows): UserGroupList =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        role: toMembershipRole(row.role),
      })),
    ),
});
