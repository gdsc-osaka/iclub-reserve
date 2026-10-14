import type { ResultAsync } from "neverthrow";
import type { QueryError } from "~/query/error";
import type {
  GroupUnreadUpdatesQuery,
  GroupUnreadUpdatesResult,
} from "~/query/reservation/group-unread-updates";

export interface GetGroupUnreadUpdatesDeps {
  readonly groupUnreadUpdatesQuery: GroupUnreadUpdatesQuery;
}

export interface GetGroupUnreadUpdatesArgs {
  readonly actorUserId: string;
  readonly now: Date;
}

/**
 * 団体側の「確認が必要なこと」に表示する未読の出来事一覧を取得するユースケース（UC-037 / COND-026）。
 */
export const getGroupUnreadUpdatesUseCase = (
  deps: GetGroupUnreadUpdatesDeps,
  args: GetGroupUnreadUpdatesArgs,
): ResultAsync<GroupUnreadUpdatesResult, QueryError> => {
  return deps.groupUnreadUpdatesQuery.findUnreadForUser(args.actorUserId, args.now);
};
