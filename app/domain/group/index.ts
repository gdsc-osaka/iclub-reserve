import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import type { BaseError } from "../error";
import { MembershipRole, StaffRole, type ActorRole } from "../membership";

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
 * この表が権限の唯一の定義元であり、判定は canPerform を通す。
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
 * グループへの操作を誰に許すかの表。
 *
 * グループの権限のルールはこの表が唯一の定義元。
 * 判定するときは Membership の `canAct` にこの表を渡すこと。
 * この表を直接読むと「所属しているか」「事務局か」の判定が抜け落ちる。
 *
 * NOTE: グループの削除は意図的に含めていない。
 * 予約が紐づくグループを物理削除すると外部キー違反になるため、
 * 無効化 (GroupStatus.Disabled) で運用する。
 */
export const groupPermissions: PermissionTable<ActorRole, GroupAction> = {
  /*
   * 所属していない人には何ひとつ許さない (COND-011 団体情報の存在秘匿)。
   * 空であることがこの条件の表明なので、消さないこと。
   */
  base: [],
  byRole: {
    [MembershipRole.Admin]: [
      GroupAction.View,
      GroupAction.Update,
      GroupAction.InviteMember,
      GroupAction.RemoveMember,
      GroupAction.UpdateMemberRole,
    ],
    [MembershipRole.Member]: [GroupAction.View],
    /*
     * 事務局は所属に関わらず全団体を管理できる (COND-009)。
     * 管理者と同じ内容を書き写しているのは、二次的に導かれる値ではなく
     * それ自体が決定だから。管理者の権限を増やしたときに事務局も一緒に増えると、
     * 事務局に何を許したのかを誰も決めないまま広がってしまう。
     */
    [StaffRole]: [
      GroupAction.View,
      GroupAction.Update,
      GroupAction.InviteMember,
      GroupAction.RemoveMember,
      GroupAction.UpdateMemberRole,
    ],
  },
};

export const GroupErrorCode = {
  GroupNotFound: "GROUP_NOT_FOUND",
  /** 団体を見られるが、その操作をする権限が無い */
  GroupForbidden: "GROUP_FORBIDDEN",
  /** 入力された値が不正（団体名が空・役割が不正など） */
  GroupInvalidInput: "GROUP_INVALID_INPUT",
  /** 操作の対象にしたメンバーが、その団体に居ない */
  MemberNotFound: "MEMBER_NOT_FOUND",
  /** 操作の対象にした招待が、その団体に無い（すでに取り消された・承諾された・期限切れなど） */
  InvitationNotFound: "INVITATION_NOT_FOUND",
  /** その操作をすると団体の管理者が 0 人になってしまう */
  LastAdminRequired: "LAST_ADMIN_REQUIRED",
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
