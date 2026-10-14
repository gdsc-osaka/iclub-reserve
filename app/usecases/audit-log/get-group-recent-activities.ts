import { ok, type ResultAsync, safeTry } from "neverthrow";

import {
  type AuditLogActorView,
  RECENT_ACTIVITIES_LIMIT,
  recentActivitiesSince,
  toAuditLogActorView,
} from "~/domain/audit-log";
import type {
  GroupRecentActivitiesQuery,
  GroupRecentActivityItem,
} from "~/query/audit-log/group-recent-activities";
import type { QueryError } from "~/query/error";
import type { UserGroupListQuery } from "~/query/user/user-group-list";

export interface GetGroupRecentActivitiesDeps {
  readonly userGroupListQuery: UserGroupListQuery;
  readonly groupRecentActivitiesQuery: GroupRecentActivitiesQuery;
}

export interface GetGroupRecentActivitiesArgs {
  readonly actorUserId: string;
  /** 見る人が事務局かどうか。操作者を「事務局」と伏せるかの判定に使う（COND-012） */
  readonly isStaff: boolean;
  readonly now: Date;
}

/** 画面に渡す 1 件。操作者は見る人に応じて詰め替えてある */
export type GroupRecentActivityView = Omit<
  GroupRecentActivityItem,
  "actorName" | "actedAsStaff"
> & {
  readonly actor: AuditLogActorView;
};

/**
 * ダッシュボードの「団体の最近の動き」に出す操作履歴を取得するユースケース（SCR-022 / UC-025）。
 *
 * 所属団体の直近 7 日の操作履歴を、新しい順に最大 5 件返す。
 * 見せる範囲は団体での役割で決まる（COND-012 (2)・(3)）。本人の操作と、予約に対する事務局の横断権限による操作は除く。
 */
export const getGroupRecentActivitiesUseCase = (
  deps: GetGroupRecentActivitiesDeps,
  args: GetGroupRecentActivitiesArgs,
): ResultAsync<readonly GroupRecentActivityView[], QueryError> =>
  safeTry(async function* () {
    const groups = yield* deps.userGroupListQuery.findByUserId(args.actorUserId);
    if (groups.length === 0) {
      return ok([]);
    }

    const activities = yield* deps.groupRecentActivitiesQuery.findRecentActivities({
      actorUserId: args.actorUserId,
      groups: groups.map((group) => ({ id: group.id, role: group.role })),
      since: recentActivitiesSince(args.now),
      limit: RECENT_ACTIVITIES_LIMIT,
    });

    return ok(activities.map((activity) => toGroupRecentActivityView(activity, args.isStaff)));
  });

/** 操作者を見る人に応じて詰め替える（COND-012） */
const toGroupRecentActivityView = (
  { actorName, actedAsStaff, ...activity }: GroupRecentActivityItem,
  isStaff: boolean,
): GroupRecentActivityView => ({
  ...activity,
  actor: toAuditLogActorView({ actorName, actedAsStaff }, { isStaff }),
});
