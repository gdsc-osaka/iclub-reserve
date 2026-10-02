import { asc, count, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { groupTable } from "~/db/schema";
import { GroupStatus } from "~/domain/group";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  GroupSearchCriteria,
  GroupSearchItem,
  GroupSearchList,
  GroupSearchQuery,
} from "~/query/group/group-search";
import type { Database } from "../db";
import { memberCountsByGroup } from "./member-count";

/**
 * Cloudflare D1 (Drizzle) を使った GroupSearchQuery の実装。
 *
 * メンバー数は派生テーブルを結合して、一覧と同じ 1 回の問い合わせで数える（N+1 の防止）。
 */
export const createGroupSearchQuery = (db: Database): GroupSearchQuery => ({
  findList: (criteria: GroupSearchCriteria): ResultAsync<GroupSearchList, QueryError> => {
    const memberCounts = memberCountsByGroup(db);

    const baseQuery = db
      .select({
        id: groupTable.id,
        name: groupTable.name,
        status: groupTable.status,
        createdAt: groupTable.createdAt,
        memberCount: memberCounts.memberCount,
      })
      .from(groupTable)
      // メンバーが 0 人の団体も一覧から落とさないよう、innerJoin ではなく leftJoin にする
      .leftJoin(memberCounts, eq(memberCounts.groupId, groupTable.id));

    const queryWithFilter =
      criteria.status !== null
        ? baseQuery.where(eq(groupTable.status, criteria.status))
        : baseQuery;

    /*
     * 並び順:
     * - pending のとき: 作成日時の昇順 -> ID の昇順（待たせている団体から処理できるようにするため）
     * - それ以外（enabled / disabled / 全状態）: 団体名の昇順 -> ID の昇順
     */
    const queryWithOrder =
      criteria.status === GroupStatus.Pending
        ? queryWithFilter.orderBy(asc(groupTable.createdAt), asc(groupTable.id))
        : queryWithFilter.orderBy(asc(groupTable.name), asc(groupTable.id));

    return ResultAsync.fromPromise(queryWithOrder, (error): QueryError => ({
      code: QueryErrorCode.DatabaseError,
      message: "団体一覧の取得に失敗しました。",
      cause: error,
    })).map((rows): GroupSearchList =>
      rows.map((row): GroupSearchItem => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        memberCount: row.memberCount ?? 0,
      })),
    );
  },

  countByStatus: (): ResultAsync<Record<GroupStatus, number>, QueryError> =>
    ResultAsync.fromPromise(
      db
        .select({
          status: groupTable.status,
          count: count(),
        })
        .from(groupTable)
        .groupBy(groupTable.status),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "ステータス別団体数の取得に失敗しました。",
        cause: error,
      }),
    ).map((rows): Record<GroupStatus, number> => {
      // 1 件も無い状態は行が返らないので、0 で埋めてから上書きする
      const counts: Record<GroupStatus, number> = {
        [GroupStatus.Pending]: 0,
        [GroupStatus.Enabled]: 0,
        [GroupStatus.Disabled]: 0,
      };

      for (const row of rows) {
        counts[row.status] = row.count;
      }

      return counts;
    }),
});
