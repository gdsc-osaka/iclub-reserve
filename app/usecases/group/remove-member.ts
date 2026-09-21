import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import { wouldRemoveLastAdmin } from "~/domain/group/admin-count";
import type { MembershipError, MembershipRepository } from "~/domain/membership";
import { canPerform, MembershipRole } from "~/domain/membership";

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
 * 団体が存在しないか、あるいは所属していない（存在秘匿）ときに返すエラー。
 *
 * 「所属していないグループ」と「存在しないグループ」で同じ値を返すことで、
 * グループ ID を総当たりされても、そのグループがあるかどうかを気取られないようにする（COND-011 存在の秘匿）。
 * そのため、この関数を通さずに個別のメッセージを書いてはいけない。
 */
const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.GroupNotFound,
  message: "グループが見つかりません。",
});

/** Membership 取得・削除時の DB エラーを GroupError に変換する */
const toGroupDatabaseError = (error: MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "メンバー情報の処理に失敗しました。",
  cause: error,
});

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
 *    - 事務局スタッフの場合: 事務局は団体に所属せず（member 行を持たない）、全団体の管理権限を持つため、
 *      membershipRepository の所属確認をスキップして直接操作を許可する。
 *    - 一般利用者の場合: 操作者のメンバーシップを取得し、閲覧権限（GroupAction.View）がなければ
 *      存在秘匿のため groupNotFound() を返す。View 権限はあるが RemoveMember 権限がない場合は、
 *      GroupForbidden「メンバーを削除できるのは管理者と事務局だけです。」を返す。
 * 5. 対象メンバーの存在確認:
 *    指定された団体に対象ユーザーが所属しているかを検索し、存在しなければ MemberNotFound を返す。
 * 6. 最後の管理者の保護（GROUP_MIN_ADMIN_COUNT = 1）:
 *    対象が管理者のときだけ countAdmins で管理者数を取得し、wouldRemoveLastAdmin で 0 人にならないかを判定する。
 *    一般メンバーの削除では管理者の人数は減らないため、countAdmins は呼ばない。
 *    なお、対象が自分自身かどうかは条件に含めない。他に管理者がいるなら自分自身の脱退も許容するという
 *    運用方針が、この 1 つの条件に自然に含まれているためである。
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

  // 3. 認可判定
  const checkPermission = (): ResultAsync<void, GroupError> => {
    if (args.isStaff) {
      return okAsync(undefined);
    }

    return deps.membershipRepository
      .findByGroupAndUser(groupId, args.actorUserId)
      .mapErr(toGroupDatabaseError)
      .andThen((actorMembership) => {
        // 閲覧権限がない場合は団体の存在自体を秘匿する（COND-011）
        if (!canPerform(groupPermissions, actorMembership, GroupAction.View)) {
          return errAsync(groupNotFound());
        }

        // 閲覧権限はあるが削除権限がない一般メンバーの場合
        if (!canPerform(groupPermissions, actorMembership, GroupAction.RemoveMember)) {
          return errAsync({
            code: GroupErrorCode.GroupForbidden,
            message: "メンバーを削除できるのは管理者と事務局だけです。",
          });
        }

        return okAsync(undefined);
      });
  };

  return checkPermission().andThen(() =>
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

        const targetIsAdmin = targetMembership.roles.includes(MembershipRole.Admin);

        // 5. 最後の管理者の保護
        //    対象が管理者である場合のみ管理者人数を確認する。
        //    一般メンバーの削除では人数が減らないため countAdmins は呼ばない。
        const checkLastAdmin = (): ResultAsync<void, GroupError> => {
          if (targetIsAdmin) {
            return deps.membershipRepository
              .countAdmins(groupId)
              .mapErr(toGroupDatabaseError)
              .andThen((adminCount) => {
                if (
                  wouldRemoveLastAdmin({
                    adminCount,
                    targetIsAdmin: true,
                    targetStaysAdmin: false,
                  })
                ) {
                  return errAsync({
                    code: GroupErrorCode.LastAdminRequired,
                    message:
                      "管理者が 0 人になるため、最後の管理者は削除できません。先に別のメンバーを管理者にしてください。",
                  });
                }

                return okAsync(undefined);
              });
          }

          return okAsync(undefined);
        };

        return checkLastAdmin().andThen(() =>
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
