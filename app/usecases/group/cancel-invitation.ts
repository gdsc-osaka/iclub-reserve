import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { GroupError } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import type { InvitationRepository } from "~/domain/invitation";
import type { MembershipError, MembershipRepository } from "~/domain/membership";
import { canPerform } from "~/domain/membership";

export interface CancelInvitationDeps {
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
}

export interface CancelInvitationArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 取り消す招待の ID */
  readonly invitationId: string;
}

/**
 * 団体が存在しないか、あるいは所属していない（存在秘匿）ときに返すエラー。
 *
 * 「所属していないグループ」と「存在しないグループ」で同じ値を返すことで、
 * グループ ID を総当たりされても、そのグループがあるかどうかを気取られないようにする（COND-011 存在の秘匿）。
 */
const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.GroupNotFound,
  message: "グループが見つかりません。",
});

/** Membership 取得時の DB エラーを GroupError に変換する */
const toGroupDatabaseError = (error: MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "メンバー情報の処理に失敗しました。",
  cause: error,
});

/**
 * 承諾待ちの招待を取り消すユースケース（REQ-017 / UC-011）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. invitationId のトリム検証:
 *    空文字または空白のみの場合は無効な入力として GroupInvalidInput を返す。
 * 3. 認可判定（COND-009 / COND-011）:
 *    - 事務局スタッフの場合: 事務局は所属の有無に関わらず全団体の管理権限を持つため（COND-009）、所属確認をスキップ。
 *    - 一般利用者の場合: 操作者のメンバーシップを取得し、閲覧権限（GroupAction.View）がなければ
 *      存在秘匿のため groupNotFound() を返す。View 権限はあるが InviteMember 権限がない場合は、
 *      GroupForbidden「メンバーを招待できるのは管理者と事務局だけです。」を返す。
 * 4. 招待の取り消し実行（invitationRepository.cancel）:
 *    キャンセル件数が 0 件の場合は、既に別管理者にキャンセルされたか、または承諾済みであるため、
 *    InvitationNotFound を返す。
 *
 * 【事前 SELECT による存在確認を行わない理由】
 * 条件付きの UPDATE 1 回で「存在して承諾待ちなら取り消す・無ければ 0 件」が判定できるため、
 * 事前 SELECT を省くことで D1 への往復レイテンシを 1 回削減できる。
 * さらに、「読んでから書く」までの間に他人が先に取り消す・承諾するといった競合が原理的に起きない。
 */
export const cancelInvitationUseCase = (
  deps: CancelInvitationDeps,
  args: CancelInvitationArgs,
): ResultAsync<null, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る（存在秘匿）
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. 招待 ID の検証
  const invitationId = args.invitationId.trim();
  if (invitationId === "") {
    return errAsync({
      code: GroupErrorCode.GroupInvalidInput,
      message: "取り消す招待が指定されていません。",
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

        // 閲覧権限はあるが招待権限がない一般メンバーの場合
        if (!canPerform(groupPermissions, actorMembership, GroupAction.InviteMember)) {
          return errAsync({
            code: GroupErrorCode.GroupForbidden,
            message: "メンバーを招待できるのは管理者と事務局だけです。",
          });
        }

        return okAsync(undefined);
      });
  };

  return checkPermission().andThen(() =>
    // 4. 招待を取り消す
    deps.invitationRepository.cancel(groupId, invitationId).andThen((canceledCount) => {
      if (canceledCount === 0) {
        return errAsync({
          code: GroupErrorCode.InvitationNotFound,
          message: "対象の招待が見つかりません。すでに取り消されたか、承諾された可能性があります。",
        });
      }

      return okAsync(null);
    }),
  );
};
