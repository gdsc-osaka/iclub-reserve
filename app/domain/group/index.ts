import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import type { BaseError } from "../error";
import { MembershipRole } from "../membership";

export const GroupStatus = {
  Enabled: "enabled",
  Pending: "pending",
  Disabled: "disabled",
} as const;
export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];

export interface Group {
  id: string;
  name: string;
  status: GroupStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * グループに対して実行できる操作。
 *
 * ここに並べてよいのは「グループそのもの」への操作だけ。
 * 予約や施設への操作は、それぞれのドメインが自分の一覧を持つこと。
 *
 * NOTE: すべての操作が Better Auth 側と共有されるわけではない。
 * - View        … このアプリ独自。Better Auth に対応する statement は無く、
 *                 自前のユースケース (app/usecases/group/*) だけが参照する。
 * - Update      … Better Auth の `organization: ["update"]` に対応する。
 * - InviteMember… Better Auth の `invitation: ["create", "cancel"]` に対応する。
 *
 * つまりここに操作を足しても、自動で Better Auth 側に効くわけではない。
 * 対応付けは app/lib/auth/permission.ts に書く。
 */
export const GroupAction = {
  /** グループ情報の閲覧 */
  View: "view",
  /** グループ情報の編集 */
  Update: "update",
  /** グループへのメンバー招待 */
  InviteMember: "invite_member",
  /** グループメンバーの役割変更 */
  UpdateMemberRole: "update_member_role",
  /** グループからのメンバー追放 */
  RemoveMember: "remove_member",
} as const;
export type GroupAction = (typeof GroupAction)[keyof typeof GroupAction];

/**
 * 役割ごとに許可されるグループへの操作。
 *
 * グループの権限のルールはこの表が唯一の定義元。Better Auth の Access Control ロール
 * (app/lib/auth/permission.ts) もこの表から導出しているので、
 * 権限を変えたいときはここだけを直せばよい。
 *
 * 判定するときは Membership の `canPerform` にこの表を渡すこと。
 * この表を直接読むと「所属しているか」の判定が抜け落ちる。
 *
 * NOTE: グループの削除は意図的に含めていない。
 * 予約が紐づくグループを物理削除すると外部キー違反になるため、
 * 無効化 (GroupStatus.Disabled) で運用する。
 */
export const groupPermissions: PermissionTable<MembershipRole, GroupAction> = {
  [MembershipRole.Admin]: [
    GroupAction.View,
    GroupAction.Update,
    GroupAction.InviteMember,
    GroupAction.RemoveMember,
    GroupAction.UpdateMemberRole,
  ],
  [MembershipRole.Member]: [GroupAction.View],
};

export const GroupErrorCode = {
  GroupNotFound: "GROUP_NOT_FOUND",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type GroupErrorCode = (typeof GroupErrorCode)[keyof typeof GroupErrorCode];

export interface GroupError extends BaseError {
  readonly code: GroupErrorCode;
}

/**
 * 自分が所属しているグループと、そのグループでの役割の組。
 *
 * 画面の共通部分（サイドバー・ボトムバー）とダッシュボードは
 * 「どの団体に所属しているか」と「その団体で管理者か」の両方を必要とする。
 * 2 回に分けて問い合わせると DB へのアクセスが増えるので、1 つにまとめている。
 */
export interface GroupMembership {
  readonly group: Group;
  readonly roles: readonly MembershipRole[];
}

export interface GroupRepository {
  findById(id: string): ResultAsync<Group, GroupError>;

  /**
   * 指定したユーザーが所属しているグループを、すべて取得する。
   *
   * - 1 件も所属していない場合: ok([])
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   *
   * NOTE: 所属が 0 件なのは異常ではないので、GROUP_NOT_FOUND にはしない。
   * ここをエラーにすると、まだどの団体にも入っていない人の画面が
   * 「グループが見つかりません」になってしまう。
   *
   * 並び順は名前の昇順で固定する。順序を決めずに返すと、
   * 再読み込みのたびにサイドバーの並びが入れ替わって見えるおそれがある。
   */
  findAllByMemberUserId(userId: string): ResultAsync<readonly GroupMembership[], GroupError>;
}
