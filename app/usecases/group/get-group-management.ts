import { errAsync, ResultAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { GroupAction, GroupErrorCode, groupPermissions } from "~/domain/group";
import type { MembershipError, MembershipRepository, MembershipRole } from "~/domain/membership";
import { canPerform } from "~/domain/membership";
import type { QueryError } from "~/query/error";
import type {
  GroupInvitationList,
  GroupInvitationListQuery,
} from "~/query/group/group-invitation-list";
import type { GroupMemberList, GroupMemberListQuery } from "~/query/group/group-member-list";

export interface GetGroupManagementDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
  readonly groupMemberListQuery: GroupMemberListQuery;
  readonly groupInvitationListQuery: GroupInvitationListQuery;
}

export interface GetGroupManagementArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても管理できる */
  readonly isStaff: boolean;
  /** 招待の期限切れを判定する基準時刻 */
  readonly now: Date;
}

/** 管理権限が無い人に見せるメンバー。メールアドレスを持たない */
export interface GroupMemberSummary {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly roles: readonly MembershipRole[];
}

/**
 * 画面 1 つ分のデータ。`canManage` で 2 つの形に分かれる（判別可能なユニオン）。
 * こうしておくと、管理権限が無い経路では `email` に触れるコードが
 * そもそも型エラーになり、うっかり漏らせなくなる。
 */
export type GroupManagementView =
  | {
      readonly canManage: false;
      readonly group: Group;
      readonly members: readonly GroupMemberSummary[];
    }
  | {
      readonly canManage: true;
      readonly group: Group;
      readonly members: GroupMemberList;
      readonly invitations: GroupInvitationList;
    };

/**
 * 閲覧できないときに返すエラー。
 *
 * 「所属していないグループ」と「存在しないグループ」で同じ値を返すことで、
 * グループ ID を総当たりされても、そのグループがあるかどうかを気取られないようにする（COND-011 存在の秘匿）。
 * そのため、この関数を通さずに個別のメッセージを書いてはいけない。
 */
const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.GroupNotFound,
  message: "グループが見つかりません。",
});

/** Query や Membership 取得時の DB エラーを GroupError に変換する */
const toGroupDatabaseError = (error: QueryError | MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "グループ情報の取得に失敗しました。",
  cause: error,
});

/**
 * 団体管理画面（SCR-007）の表示に必要なデータを取得するユースケース。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId が空文字または空白のみの場合、DB 問い合わせを行わず即座に NOT_FOUND を返す。
 * 2. 事務局（isStaff === true）の場合:
 *    事務局は団体に所属せず（member 行を持たない、COND-009）、全団体の管理権限を持つ。
 *    そのため membershipRepository を引かず、canManage: true として扱う。
 *    また事務局に対しては存在秘匿（COND-011）の必要がないため、存在しない場合は素直に GroupNotFound を返す。
 * 3. 事務局でない一般利用者の場合:
 *    先に membershipRepository を確認する。DB エラーは GroupNotFound に潰さず DatabaseError として返す
 *    （潰すとシステム障害が 404 として誤認され、監視や対応が遅れるため）。
 *    閲覧権限（GroupAction.View）が無い場合は、団体本体を取りに行かずに groupNotFound() を返す。
 *    先に団体を取りに行くと、存在する団体のときだけ DB クエリが 1 回増え、
 *    応答時間の差から団体の存在を推測できてしまう（COND-011）。
 *    管理権限（canManage）の判定には `GroupAction.Update` で代表させる。
 *    SCR-007 の各操作（編集・招待・昇格/降格・削除）は `groupPermissions` 上すべて同じ管理者（admin）にのみ
 *    許可されているため、どれで代表させても結果が変わらない。将来これらが別の役割に分かれる場合は、
 *    セクションごとに canPerform を呼び分けること。
 * 4. 取得と詰め替え:
 *    - canManage === false: 団体とメンバー一覧を取得。メンバーから実際に email を除去して
 *      GroupMemberSummary に詰め替える（型を絞るだけでなく実データを捨てることで漏洩を防ぐ）。
 *    - canManage === true: 団体、メンバー一覧、承諾待ち招待一覧を取得。
 *      招待は expiresAt > now の有効なものだけに絞り込む。
 */
export const getGroupManagementUseCase = (
  deps: GetGroupManagementDeps,
  args: GetGroupManagementArgs,
): ResultAsync<GroupManagementView, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. 事務局スタッフの場合（COND-009）
  if (args.isStaff) {
    return deps.groupRepository.findById(groupId).andThen((group) =>
      ResultAsync.combine([
        deps.groupMemberListQuery.findByGroupId(groupId).mapErr(toGroupDatabaseError),
        deps.groupInvitationListQuery.findByGroupId(groupId).mapErr(toGroupDatabaseError),
      ]).map(([members, invitations]): GroupManagementView => ({
        canManage: true,
        group,
        members,
        invitations: invitations.filter((inv) => inv.expiresAt.getTime() > args.now.getTime()),
      })),
    );
  }

  // 3. 事務局でない一般利用者の場合
  return deps.membershipRepository
    .findByGroupAndUser(groupId, args.actorUserId)
    .mapErr(toGroupDatabaseError)
    .andThen((membership) => {
      // 閲覧権限がない場合は団体を取りに行かずに存在秘匿（COND-011）
      if (!canPerform(groupPermissions, membership, GroupAction.View)) {
        return errAsync(groupNotFound());
      }

      const canManage = canPerform(groupPermissions, membership, GroupAction.Update);

      if (canManage) {
        return ResultAsync.combine([
          deps.groupRepository.findById(groupId),
          deps.groupMemberListQuery.findByGroupId(groupId).mapErr(toGroupDatabaseError),
          deps.groupInvitationListQuery.findByGroupId(groupId).mapErr(toGroupDatabaseError),
        ]).map(([group, members, invitations]): GroupManagementView => ({
          canManage: true,
          group,
          members,
          invitations: invitations.filter((inv) => inv.expiresAt.getTime() > args.now.getTime()),
        }));
      }

      // 一般メンバー: 招待は取得せず、メンバーのメールアドレスを除去して詰め替える
      return ResultAsync.combine([
        deps.groupRepository.findById(groupId),
        deps.groupMemberListQuery.findByGroupId(groupId).mapErr(toGroupDatabaseError),
      ]).map(([group, rawMembers]): GroupManagementView => ({
        canManage: false,
        group,
        members: rawMembers.map((m) => ({
          memberId: m.memberId,
          userId: m.userId,
          name: m.name,
          roles: m.roles,
        })),
      }));
    });
};
