import { errAsync, ResultAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { GroupAction, groupPermissions } from "~/domain/group";
import type { MembershipRepository, MembershipRole } from "~/domain/membership";
import { canAct } from "~/domain/membership";
import {
  ensureGroupIsVisible,
  groupNotFound,
  resolveGroupActor,
  toGroupDatabaseError,
} from "./_shared/group-authorization";
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
  readonly role: MembershipRole;
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
 * 団体管理画面（SCR-007）の表示に必要なデータを取得するユースケース。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId が空文字または空白のみの場合、DB 問い合わせを行わず即座に NOT_FOUND を返す。
 * 2. 認可判定（resolveGroupActor と ensureGroupIsVisible）:
 *    事務局は所属を引かずに通る（COND-009）。一般利用者は先に所属を確認し、
 *    閲覧権限（GroupAction.View）が無ければ団体本体を取りに行かずに存在を秘匿する（COND-011）。
 *    先に団体を取りに行くと、存在する団体のときだけ DB クエリが 1 回増え、
 *    応答時間の差から団体の存在を推測できてしまう。
 *    見られないときは NotVisible を返す。利用者への応答を 404 に揃えるのは画面の側である（ADR-004 決定 4）。
 *    DB エラーは NotFound に潰さず DatabaseError として返す
 *    （潰すとシステム障害が 404 として誤認され、監視や対応が遅れるため）。
 * 3. 管理権限（canManage）の判定には `GroupAction.Update` で代表させる。
 *    SCR-007 の各操作（編集・招待・昇格/降格・削除）は `groupPermissions` 上すべて同じ管理者（admin）にのみ
 *    許可されているため、どれで代表させても結果が変わらない。将来これらが別の役割に分かれる場合は、
 *    セクションごとに canAct を呼び分けること。
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

  // 2. 認可判定（事務局は所属を引かずに通る。COND-009 / COND-011）
  return resolveGroupActor(deps, { ...args, groupId }).andThen((actor) =>
    ensureGroupIsVisible(actor).andThen(() => {
      /*
       * 管理できる人（管理者と事務局）にだけ、承諾待ちの招待とメンバーのメールアドレスを渡す。
       * 一般メンバーには招待を取りに行かず、メールアドレスは実データごと落とす。
       * 型を絞るだけでは、通信の中身を見れば読めてしまう。
       */
      const canManage = canAct(groupPermissions, actor, GroupAction.Update);

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
          role: m.role,
        })),
      }));
    }),
  );
};
