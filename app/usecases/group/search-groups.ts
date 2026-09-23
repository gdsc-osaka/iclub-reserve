import { errAsync, ResultAsync } from "neverthrow";

import type { GroupStatus } from "~/domain/group";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  GroupSearchCriteria,
  GroupSearchList,
  GroupSearchQuery,
} from "~/query/group/group-search";

export interface SearchGroupsDeps {
  readonly groupSearchQuery: GroupSearchQuery;
}

export interface SearchGroupsArgs {
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。全団体の管理・検索は事務局限定 */
  readonly isStaff: boolean;
  /** 絞り込むステータス。null のときは全ステータス */
  readonly status: GroupStatus | null;
}

export interface SearchGroupsResult {
  readonly items: GroupSearchList;
  readonly counts: Record<GroupStatus, number>;
}

/**
 * 事務局向け全団体一覧画面（SCR-008）のデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 */
export const searchGroupsUseCase = (
  deps: SearchGroupsDeps,
  args: SearchGroupsArgs,
): ResultAsync<SearchGroupsResult, QueryError> => {
  // 事務局権限のないユーザーが全団体の一覧を閲覧することは禁止（COND-009）
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではない人が全団体一覧を開こうとした。",
    });
  }

  const criteria: GroupSearchCriteria = {
    status: args.status,
  };

  return ResultAsync.combine([
    deps.groupSearchQuery.findList(criteria),
    deps.groupSearchQuery.countByStatus(),
  ]).map(([items, counts]): SearchGroupsResult => ({
    items,
    counts,
  }));
};
