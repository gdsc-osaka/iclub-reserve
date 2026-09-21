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
  /** 団体を見られるが、その操作をする権限が無い */
  GroupForbidden: "GROUP_FORBIDDEN",
  /** 入力された値が不正（団体名が空・長すぎるなど） */
  GroupInvalidInput: "GROUP_INVALID_INPUT",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type GroupErrorCode = (typeof GroupErrorCode)[keyof typeof GroupErrorCode];

export interface GroupError extends BaseError {
  readonly code: GroupErrorCode;
}

/** 団体名の更新に必要な値。触ってよい列だけを並べる */
export interface UpdateGroupNameInput {
  readonly id: string;
  /**
   * 検証済みの団体名（`validateGroupName` を通したもの）。
   *
   * ここへ渡ってくる時点で検証済みであること。
   * 検証はドメインの `validateGroupName` が唯一の担当で、リポジトリでは確かめ直さない。
   */
  readonly name: string;
  readonly updatedAt: Date;
}

export interface GroupRepository {
  findById(id: string): ResultAsync<Group, GroupError>;
  updateName(input: UpdateGroupNameInput): ResultAsync<Group, GroupError>;
}
