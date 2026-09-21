import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import type { MembershipError, MembershipRepository } from "~/domain/membership";
import { canAct } from "~/domain/membership";
import { groupNotFound } from "./_shared/group-authorization";

/** このユースケースが必要とする依存 */
export interface GetGroupDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
}

/** このユースケースへの入力 */
export interface GetGroupArgs {
  readonly groupId: string;
  /** 閲覧しようとしているユーザーの ID */
  readonly actorUserId: string;
}

/**
 * グループ ID を指定して、そのグループの情報を 1 件取得するユースケース。
 *
 * 取得できるのは自分が所属しているグループだけ。所属していないグループは
 * 存在そのものを隠したいので、権限がない旨ではなく「見つかりません」を返す。
 *
 * 依存 (リポジトリ) を引数で受け取る形にしているので、
 * テスト時には D1 を使わないダミーのリポジトリに差し替えられる。
 *
 * エラーは throw せず ResultAsync で返すため、
 * 呼び出し側は必ず成功・失敗の両方を処理することになる。
 */
export const getGroupUseCase = (
  deps: GetGroupDeps,
  args: GetGroupArgs,
): ResultAsync<Group, GroupError> => {
  const id = args.groupId.trim();

  // 空文字や空白だけの ID は DB へ問い合わせるまでもないので、ここで打ち切る
  if (id === "") {
    return errAsync(groupNotFound());
  }

  /*
   * 先に所属を調べ、閲覧できないと分かった時点で打ち切る。
   * グループ本体を取りに行ってから判定すると、存在するグループのときだけ
   * 問い合わせが 1 回増え、応答時間の差から存在を推測できてしまう。
   */
  return deps.membershipRepository
    .findByGroupAndUser(id, args.actorUserId)
    .mapErr(
      // DB エラーを「見つかりません」に潰してはいけない。
      // 潰すと障害が 404 として表示され、利用者にも監視にも異常が伝わらなくなる。
      (error: MembershipError): GroupError => ({
        code: GroupErrorCode.DatabaseError,
        message: "グループ情報の取得に失敗しました。",
        cause: error,
      }),
    )
    .andThen((membership) =>
      /*
       * NOTE: このユースケースは事務局かどうかを受け取っていないため、所属だけで判定している。
       * 事務局から呼ぶ必要が出たら、引数に isStaff を足して actor を組み立てること。
       */
      canAct(groupPermissions, { isStaff: false, membership }, GroupAction.View)
        ? deps.groupRepository.findById(id)
        : errAsync(groupNotFound()),
    );
};
