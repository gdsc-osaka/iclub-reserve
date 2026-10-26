import { okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { GroupCalendarFeedRepository } from "~/domain/calendar";
import type { GroupError, GroupRepository } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import { resolveMembershipForCalendarFeed } from "../group/_shared/resolve-membership-for-calendar-feed";

export interface IssueGroupCalendarFeedDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
  readonly groupCalendarFeedRepository: GroupCalendarFeedRepository;
  readonly generateToken: () => string;
}

export interface IssueGroupCalendarFeedArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
  readonly now: Date;
}

export interface IssueGroupCalendarFeedResult {
  readonly token: string;
}

/**
 * 自団体の予約カレンダー購読 URL（トークン）を発行するユースケース（ADR-013 決定 6 / COND-029(1)）。
 *
 * 【設計上の配慮】
 * 1. 認可判定:
 *    `resolveMembershipForCalendarFeed` で操作者がその団体に所属していることを確認する。
 *    役割（管理者・メンバー）は問わない。所属していない事務局は Forbidden、一般利用者は NotVisible。
 * 2. 冪等性:
 *    すでに発行済みの場合は新規作成せず、既存のトークンをそのまま返す。
 * 3. 操作履歴:
 *    本人の設定変更であり団体の業務データを変更しないため、操作履歴（INFO-008）には記録しない（COND-029(7)）。
 */
export const issueGroupCalendarFeedUseCase = (
  deps: IssueGroupCalendarFeedDeps,
  args: IssueGroupCalendarFeedArgs,
): ResultAsync<IssueGroupCalendarFeedResult, GroupError> =>
  safeTry(async function* () {
    const membership = yield* resolveMembershipForCalendarFeed(deps, args);
    const token = deps.generateToken();

    const feed = yield* deps.groupCalendarFeedRepository.issue({
      membershipId: membership.id,
      token,
      now: args.now,
    });

    return okAsync({ token: feed.token });
  });
