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
 * 判定するときは `canPerform` (app/domain/membership.ts) にこの表を渡すこと。
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

export interface GroupRepository {
  findById(id: string): ResultAsync<Group, GroupError>;
}
