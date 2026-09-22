import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupAction } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import { MembershipRole } from "~/domain/membership";
import {
  ensureGroupPermission,
  groupNotFound,
  toGroupDatabaseError,
} from "./_shared/group-authorization";
import { ensureNotLastAdmin } from "./_shared/last-admin";
import { memberNotFound, memberNotSpecified } from "./_shared/target-member";

export interface RemoveMemberDeps {
  readonly membershipRepository: MembershipRepository;
}

export interface RemoveMemberArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
  /** 団体から外す相手のユーザー ID */
  readonly targetUserId: string;
}

export interface RemoveMemberResult {
  /** 実際に外したユーザーの ID。操作した本人と同じなら、画面は別の場所へ戻す必要がある */
  readonly removedUserId: string;
}

/**
 * メンバーを団体から削除（所属解除）するユースケース（REQ-019 / UC-011）。
 *
 * 【確かめる順序の理由】
 * 入力の検証を認可より先に置いている。検証の結果は特定の団体に依存しないので、
 * 先に返しても団体の有無は漏れず、無効なリクエストで D1 を往復せずに済む。
 * 認可そのものの判断（事務局を通す・存在を秘匿する・足りない権限を伝える）は
 * ensureGroupPermission が持つ（COND-009 / COND-011）。
 *
 * 【同時実行の限界について】
 * Cloudflare D1 では複数クエリにまたがる厳密なトランザクションを張れないため、
 * 2 人の管理者が同時に互いを削除した場合、管理者が 0 人になる余地が理論上残る。
 * それでも事務局スタッフ（COND-009）が介入してメンバーを追加・管理者に指名できるので、
 * 過剰な排他制御は行わず、この割り切りを許容している。
 */
export const removeMemberUseCase = (
  deps: RemoveMemberDeps,
  args: RemoveMemberArgs,
): ResultAsync<RemoveMemberResult, GroupError> =>
  safeTry(async function* () {
    // 空文字や空白だけの ID は、DB へ問い合わせずに打ち切る（存在秘匿）
    const groupId = args.groupId.trim();
    if (groupId === "") return errAsync(groupNotFound());

    const targetUserId = args.targetUserId.trim();
    if (targetUserId === "") return errAsync(memberNotSpecified());

    yield* ensureGroupPermission(deps, { ...args, groupId }, GroupAction.RemoveMember);

    const target = yield* deps.membershipRepository
      .findByGroupAndUser(groupId, targetUserId)
      .mapErr(toGroupDatabaseError);
    if (target === null) return errAsync(memberNotFound());

    yield* ensureNotLastAdmin(
      deps,
      groupId,
      { targetIsAdmin: target.role === MembershipRole.Admin, targetStaysAdmin: false },
      "管理者が 0 人になるため、最後の管理者は削除できません。先に別のメンバーを管理者にしてください。",
    );

    const removedCount = yield* deps.membershipRepository
      .remove(groupId, targetUserId)
      .mapErr(toGroupDatabaseError);
    // 存在は確認済みだが、そこから削除までの間に別の操作で外されていることがある
    if (removedCount === 0) return errAsync(memberNotFound());

    return okAsync({ removedUserId: targetUserId });
  });
