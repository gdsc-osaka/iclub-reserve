import type { ResultAsync } from "neverthrow";
import type { QueryError } from "~/query/error";

/** 事務局一覧に並ぶメンバー 1 件分のデータ */
export interface StaffMemberView {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

/** 承諾待ちの事務局招待 1 件分のデータ */
export interface StaffPendingInvitationView {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/** 事務局管理画面（SCR-019）に表示するデータ */
export interface StaffManagementView {
  readonly members: readonly StaffMemberView[];
  readonly pendingInvitations: readonly StaffPendingInvitationView[];
}

/**
 * 事務局管理画面用の読み取り専用窓口（ポート）。
 */
export interface StaffManagementQuery {
  /**
   * 事務局メンバー一覧および承諾待ちの事務局招待一覧を取得する。
   */
  get(): ResultAsync<StaffManagementView, QueryError>;
}
