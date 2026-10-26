import { okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { GroupCalendarFeedRepository } from "~/domain/calendar";
import type { GroupError, GroupRepository } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import { resolveMembershipForCalendarFeed } from "../group/_shared/resolve-membership-for-calendar-feed";

export interface RegenerateGroupCalendarFeedDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
  readonly groupCalendarFeedRepository: GroupCalendarFeedRepository;
  readonly generateToken: () => string;
}

export interface RegenerateGroupCalendarFeedArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
  readonly now: Date;
}

export interface RegenerateGroupCalendarFeedResult {
  readonly token: string;
}

/**
 * 自団体の予約カレンダー購読 URL（トークン）を作り直すユースケース（ADR-013 決定 6 / COND-029(5)）。
 *
 * 【設計上の配慮】
 * 1. 認可判定:
 *    `resolveMembershipForCalendarFeed` で操作者がその団体に所属していることを確認する。
 *    役割は問わない。所属していない事務局は Forbidden、一般利用者は NotVisible。
 * 2. 作り直しの効果:
 *    既存の購読行のトークンを新しい乱数に置き換える。
 *    前のトークンは即座に無効化され、以後のアクセスでは 0 件のカレンダーが返るようになる。
 * 3. 操作履歴:
 *    本人の設定変更であり団体の業務データを変更しないため、操作履歴（INFO-008）には記録しない（COND-029(7)）。
 */
export const regenerateGroupCalendarFeedUseCase = (
  deps: RegenerateGroupCalendarFeedDeps,
  args: RegenerateGroupCalendarFeedArgs,
): ResultAsync<RegenerateGroupCalendarFeedResult, GroupError> =>
  safeTry(async function* () {
    const membership = yield* resolveMembershipForCalendarFeed(deps, args);
    const token = deps.generateToken();

    const feed = yield* deps.groupCalendarFeedRepository.regenerate({
      membershipId: membership.id,
      token,
      now: args.now,
    });

    return okAsync({ token: feed.token });
  });
