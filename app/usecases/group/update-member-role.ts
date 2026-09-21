import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import { wouldRemoveLastAdmin } from "~/domain/group/admin-count";
import type { MembershipError, MembershipRepository } from "~/domain/membership";
import { canPerform, isMembershipRole, MembershipRole } from "~/domain/membership";

export interface UpdateMemberRoleDeps {
  readonly membershipRepository: MembershipRepository;
}

export interface UpdateMemberRoleArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
  /** 役割を変える相手のユーザー ID */
  readonly targetUserId: string;
  /** フォームから届いた未検証の役割 */
  readonly role: string;
  readonly now: Date;
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

/** Membership 取得・更新時の DB エラーを GroupError に変換する */
const toGroupDatabaseError = (error: MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "メンバー情報の処理に失敗しました。",
  cause: error,
});

/**
 * メンバーの役割を変更するユースケース（REQ-018 / UC-012）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. 役割（role）の検証（isMembershipRole）:
 *    COND-007（単一ロール原則）を満たす。isMembershipRole は "admin" または "member" の完全一致のみを受け付けるため、不正な入力値をこの 1 行で確実に弾ける。
 * 3. targetUserId のトリム検証:
 *    空文字の場合は無効な入力として GroupInvalidInput を返す。
 * 4. 2・3 の検証を認可判定より先に置く理由:
 *    これらの検証結果は特定の団体に依存しないため、先に返しても団体の有無が外部に漏れることはない。
 *    一方で、無効なリクエストに対して不要な DB 問い合わせ（D1 の往復レイテンシとクエリコスト）を
 *    確実に削減できる。
 * 5. 認可判定（COND-009 / COND-011）:
 *    - 事務局スタッフの場合: 事務局は団体に所属せず（group_member 行を持たない）、全団体の管理権限を持つため、
 *      membershipRepository の所属確認をスキップして直接操作を許可する。
 *    - 一般利用者の場合: 操作者のメンバーシップを取得し、閲覧権限（GroupAction.View）がなければ
 *      存在秘匿のため groupNotFound() を返す。View 権限はあるが UpdateMemberRole 権限がない場合は、
 *      GroupForbidden「メンバーの役割を変更できるのは管理者と事務局だけです。」を返す。
 * 6. 対象メンバーの存在確認:
 *    指定された団体に対象ユーザーが所属しているかを検索し、存在しなければ MemberNotFound を返す。
 * 7. 最後の管理者の保護（GROUP_MIN_ADMIN_COUNT = 1）:
 *    対象が現在管理者で、かつ新しい役割が管理者でない（降格する）場合のみ、countAdmins で団体の管理者数を取得し、
 *    wouldRemoveLastAdmin で 0 人にならないかを検証する。昇格時や管理者維持時は人数が減らないため、
 *    無駄なクエリ往復を避けるために countAdmins は呼び出さない。
 *    なお、対象が自分自身かどうかは条件に含めない。他に管理者がいるなら自分自身の降格も許容するという
 *    運用方針が、この 1 つの条件に自然に含まれているためである。
 * 8. 役割の更新:
 *    updateRole を実行し、更新件数が 0 件の場合は確認後に削除されたものとして MemberNotFound を返す。
 *
 * 【同時実行の限界について】
 * Cloudflare D1 では複数クエリにまたがる厳密なトランザクションを張ることができないため、
 * 2 人の管理者が同時に互いを降格させた場合、極稀に管理者が 0 人になってしまう余地が理論上存在する。
 * しかし、万が一その状態になったとしても、システム全体の管理権限を持つ事務局スタッフ（COND-009）が
 * 役割を復旧できるため、ここでは過剰に複雑な排他制御を行わず、この割り切りを許容している。
 */
export const updateMemberRoleUseCase = (
  deps: UpdateMemberRoleDeps,
  args: UpdateMemberRoleArgs,
): ResultAsync<null, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る（存在秘匿）
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. 役割の単一性と有効性のバリデーション（COND-007）
  //    "admin,member" などの複数指定や未知の文字列もここで弾く
  if (!isMembershipRole(args.role)) {
    return errAsync({
      code: GroupErrorCode.GroupInvalidInput,
      message: "指定できない役割です。",
    });
  }
  const nextRole = args.role;

  // 3. 対象ユーザー ID のバリデーション
  const targetUserId = args.targetUserId.trim();
  if (targetUserId === "") {
    return errAsync({
      code: GroupErrorCode.GroupInvalidInput,
      message: "対象のメンバーが指定されていません。",
    });
  }

  // 4. 認可判定（事務局は所属確認をスキップ、一般利用者は所属と権限を確認）
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

        // 閲覧権限はあるが役割変更権限がない一般メンバーの場合
        if (!canPerform(groupPermissions, actorMembership, GroupAction.UpdateMemberRole)) {
          return errAsync({
            code: GroupErrorCode.GroupForbidden,
            message: "メンバーの役割を変更できるのは管理者と事務局だけです。",
          });
        }

        return okAsync(undefined);
      });
  };

  return checkPermission().andThen(() =>
    // 5. 操作対象のメンバーを取得する
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
        const nextIsAdmin = nextRole === MembershipRole.Admin;

        // 6. 最後の管理者の保護
        //    対象が管理者で、かつ非管理者に降格する場合のみ管理者人数を確認する。
        //    人数が減らない操作（昇格や変更なし）では無駄な DB 往復を行わない。
        const checkLastAdmin = (): ResultAsync<void, GroupError> => {
          if (targetIsAdmin && !nextIsAdmin) {
            return deps.membershipRepository
              .countAdmins(groupId)
              .mapErr(toGroupDatabaseError)
              .andThen((adminCount) => {
                /*
                 * 対象が自分自身かどうかは見ない。
                 * 「他に管理者が残っているなら自分を降格してもよい」という運用方針が、
                 * wouldRemoveLastAdmin の判定（残り 1 人以上）にそのまま含まれているため。
                 */
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
                      "管理者が 0 人になるため、最後の管理者は降格できません。先に別のメンバーを管理者にしてください。",
                  });
                }

                return okAsync(undefined);
              });
          }

          return okAsync(undefined);
        };

        return checkLastAdmin().andThen(() =>
          // 7. 役割の更新を実行する
          deps.membershipRepository
            .updateRole({
              groupId,
              userId: targetUserId,
              role: nextRole,
              updatedAt: args.now,
            })
            .mapErr(toGroupDatabaseError)
            .andThen((updatedCount) => {
              // 事前に存在を確認したが、直前に別操作で削除された等で 0 件だった場合
              if (updatedCount === 0) {
                return errAsync({
                  code: GroupErrorCode.MemberNotFound,
                  message: "対象のメンバーはこの団体に所属していません。",
                });
              }

              return okAsync(null);
            }),
        );
      }),
  );
};
