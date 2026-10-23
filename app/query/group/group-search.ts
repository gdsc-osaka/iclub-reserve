import { asc, count, eq } from "drizzle-orm";
import { ok, ResultAsync, safeTry } from "neverthrow";

import { groupTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { GroupStatus } from "~/domain/group";
import type { Database } from "~/infra/db";
import { memberCountsByGroup } from "~/infra/group/member-count";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局向け全団体一覧画面（SCR-008）の検索結果の 1 行。
 */
export interface GroupSearchItem {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  readonly memberCount: number;
  readonly createdAt: Date;
}

/** 団体検索結果の配列 */
export type GroupSearchList = readonly GroupSearchItem[];

export interface FindGroupSearchListArgs {
  /** 事務局かどうか（COND-009）。全団体の一覧は事務局だけが見られる */
  readonly isStaff: boolean;
  /** 絞り込むステータス。null のときは全ステータス */
  readonly status: GroupStatus | null;
}

/**
 * 条件に合う団体の一覧を取得する（SCR-008。事務局のダッシュボードの「有効化を待っている団体」でも使う）。
 *
 * 並び順:
 * - status が pending のとき: 作成日時の昇順 -> ID の昇順（待たせている団体から処理できるようにするため）
 * - それ以外（enabled / disabled / 全状態）: 団体名の昇順 -> ID の昇順
 *
 * メンバー数は派生テーブルを結合して、一覧と同じ 1 回の問い合わせで数える（N+1 の防止）。
 */
export const findGroupSearchList = (
  db: Database,
  args: FindGroupSearchListArgs,
): ResultAsync<GroupSearchList, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が全団体一覧を開こうとした。");

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
      args.status !== null ? baseQuery.where(eq(groupTable.status, args.status)) : baseQuery;

    const queryWithOrder =
      args.status === GroupStatus.Pending
        ? queryWithFilter.orderBy(asc(groupTable.createdAt), asc(groupTable.id))
        : queryWithFilter.orderBy(asc(groupTable.name), asc(groupTable.id));

    const rows = yield* ResultAsync.fromPromise(
      queryWithOrder,
      wrapError(QueryErrorCode.DatabaseError, "団体一覧の取得に失敗しました。"),
    );

    return ok(
      rows.map((row): GroupSearchItem => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        memberCount: row.memberCount ?? 0,
      })),
    );
  });

/**
 * ステータスごとの団体数を数える（SCR-008 の各タブのバッジ件数）。
 */
export const countGroupsByStatus = (
  db: Database,
  args: { readonly isStaff: boolean },
): ResultAsync<Record<GroupStatus, number>, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(args.isStaff, "事務局ではない人が団体の件数を数えようとした。");

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          status: groupTable.status,
          count: count(),
        })
        .from(groupTable)
        .groupBy(groupTable.status),
      wrapError(QueryErrorCode.DatabaseError, "ステータス別団体数の取得に失敗しました。"),
    );

    // 1 件も無い状態は行が返らないので、0 で埋めてから上書きする
    const counts: Record<GroupStatus, number> = {
      [GroupStatus.Pending]: 0,
      [GroupStatus.Enabled]: 0,
      [GroupStatus.Disabled]: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return ok(counts);
  });
