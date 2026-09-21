import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupAction, GroupErrorCode } from "~/domain/group";
import type { MembershipRepository } from "~/domain/membership";
import { MembershipRole } from "~/domain/membership";
import {
  ensureGroupPermission,
  groupNotFound,
  toGroupDatabaseError,
} from "./_shared/group-authorization";
import { ensureNotLastAdmin } from "./_shared/last-admin";

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
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. targetUserId のトリム検証:
 *    空文字の場合は無効な入力として GroupInvalidInput を返す。
 * 3. 2 の検証を認可判定より先に置く理由:
 *    入力値の検証は特定の団体に依存しないため、先に返しても団体の有無が外部に漏れることはない。
 *    無駄な DB 往復を削減する。
 * 4. 認可判定（COND-009 / COND-011）:
 *    ensureGroupPermission に任せる。事務局は所属を問わず通し、団体を見られない人には
 *    存在を秘匿し、見られるが削除できない人には足りない権限を伝える。
 * 5. 対象メンバーの存在確認:
 *    指定された団体に対象ユーザーが所属しているかを検索し、存在しなければ MemberNotFound を返す。
 * 6. 最後の管理者の保護（GROUP_MIN_ADMIN_COUNT = 1）:
 *    ensureNotLastAdmin に任せる。管理者が減る操作のときだけ人数を数え、
 *    0 人になるなら止める。一般メンバーの削除では人数が減らないので countAdmins は呼ばない。
 * 7. メンバーの削除:
 *    remove を実行し、削除件数が 0 件の場合は MemberNotFound を返す。
 *    成功時は removedUserId を返却し、画面側で自分自身を削除した場合のリダイレクト先切り替えに用いる。
 *
 * 【同時実行の限界について】
 * Cloudflare D1 では複数クエリにまたがる厳密なトランザクションを張ることができないため、
 * 2 人の管理者が同時に互いを削除した場合、管理者が 0 人になってしまう余地が理論上存在する。
 * しかし、事務局スタッフ（COND-009）が介入してメンバーを追加・管理者に指名できるため、
 * 運用上許容している。
 */
export const removeMemberUseCase = (
  deps: RemoveMemberDeps,
  args: RemoveMemberArgs,
): ResultAsync<RemoveMemberResult, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る（存在秘匿）
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. 対象ユーザー ID のバリデーション
  const targetUserId = args.targetUserId.trim();
  if (targetUserId === "") {
    return errAsync({
      code: GroupErrorCode.GroupInvalidInput,
      message: "対象のメンバーが指定されていません。",
    });
  }

  // 3. 認可判定（存在秘匿と権限の出し分けは共通の関数が持つ）
  return ensureGroupPermission(deps, { ...args, groupId }, GroupAction.RemoveMember).andThen(() =>
    // 4. 操作対象のメンバーを取得する
    deps.membershipRepository
      .findByGroupAndUser(groupId, targetUserId)
      .mapErr(toGroupDatabaseError)
      .andThen((targetMembership) => {
        if (targetMembership === null) {
          return errAsync({
            code: GroupErrorCode.MemberNotFound,
            message: "対象のメンバーはこの団体に所属していません。",
          });
        }

        const targetIsAdmin = targetMembership.role === MembershipRole.Admin;

        // 5. 最後の管理者の保護（管理者が減らない操作では人数を数えない）
        return ensureNotLastAdmin(
          deps,
          groupId,
          { targetIsAdmin, targetStaysAdmin: false },
          "管理者が 0 人になるため、最後の管理者は削除できません。先に別のメンバーを管理者にしてください。",
        ).andThen(() =>
          // 6. メンバーの削除を実行する
          deps.membershipRepository
            .remove(groupId, targetUserId)
            .mapErr(toGroupDatabaseError)
            .andThen((removedCount) => {
              if (removedCount === 0) {
                return errAsync({
                  code: GroupErrorCode.MemberNotFound,
                  message: "対象のメンバーはこの団体に所属していません。",
                });
              }

              return okAsync({ removedUserId: targetUserId });
            }),
        );
      }),
  );
};
