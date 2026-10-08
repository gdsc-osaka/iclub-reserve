/**
 * 事務局権限（BIZ-006）の操作履歴ドラフト生成純粋関数。
 *
 * 事務局への招待・取り消し・承諾・辞退・剥奪の 5 種類を扱う（VAR-002 #25〜#29）。
 * 施設・事務局権限の操作は、COND-012 により acted_as_staff は常に true、group_id は常に null となる。
 */
import {
  AuditLogAction,
  toCreatedChanges,
  toIdentityChanges,
  type AuditLogDraft,
} from "../audit-log";
import { InvitationStatus } from "../invitation";
import { StaffAction } from "./index";

/**
 * 事務局管理アクションから操作履歴アクションへの対応表。
 */
export const staffActionAuditLogActions: Record<
  typeof StaffAction.Invite | typeof StaffAction.CancelInvitation | typeof StaffAction.Revoke,
  AuditLogAction
> = {
  [StaffAction.Invite]: AuditLogAction.StaffRoleInvite,
  [StaffAction.CancelInvitation]: AuditLogAction.StaffRoleCancelInvitation,
  [StaffAction.Revoke]: AuditLogAction.StaffRoleRevoke,
};

/**
 * 事務局招待への応答から操作履歴アクションへの対応表。
 */
export const staffInvitationResponseAuditLogActions: Record<"accept" | "decline", AuditLogAction> =
  {
    accept: AuditLogAction.StaffRoleAccept,
    decline: AuditLogAction.StaffRoleDecline,
  };

/**
 * #25 事務局招待の送信（staff_role.invite）の操作履歴ドラフトを生成する。
 */
export const toStaffRoleInviteAuditLog = (
  invitationId: string,
  email: string,
  actorUserId: string,
  now: Date,
): AuditLogDraft => ({
  occurredAt: now,
  actorId: actorUserId,
  // 施設/設備・事務局権限の記録は事務局にしか行えない操作であるため、acted_as_staff は常に true（COND-012）
  actedAsStaff: true,
  action: AuditLogAction.StaffRoleInvite,
  targetId: invitationId,
  groupId: null,
  changes: toCreatedChanges({ email }),
});

/**
 * #26 事務局招待の取り消し（staff_role.cancel_invitation）の操作履歴ドラフトを生成する。
 */
export const toStaffRoleCancelInvitationAuditLog = (
  invitationId: string,
  email: string,
  actorUserId: string,
  now: Date,
): AuditLogDraft => ({
  occurredAt: now,
  actorId: actorUserId,
  actedAsStaff: true,
  action: AuditLogAction.StaffRoleCancelInvitation,
  targetId: invitationId,
  groupId: null,
  changes: {
    ...toIdentityChanges({ email }),
    status: {
      before: InvitationStatus.Pending,
      after: InvitationStatus.Canceled,
    },
  },
});

/**
 * #27 事務局招待の承諾（staff_role.accept）の操作履歴ドラフトを生成する。
 */
export const toStaffRoleAcceptAuditLog = (
  input: {
    readonly invitationId: string;
    readonly userId: string;
    readonly actorIsStaff: boolean;
  },
  now: Date,
): AuditLogDraft => ({
  occurredAt: now,
  actorId: input.userId,
  // 招待された本人による承諾だが、COND-012 により事務局権限の記録は true とする
  actedAsStaff: true,
  action: AuditLogAction.StaffRoleAccept,
  targetId: input.userId,
  groupId: null,
  changes: {
    is_staff: {
      before: input.actorIsStaff,
      after: true,
    },
    ...toIdentityChanges({ staff_invitation_id: input.invitationId }),
  },
});

/**
 * #28 事務局招待の辞退（staff_role.decline）の操作履歴ドラフトを生成する。
 */
export const toStaffRoleDeclineAuditLog = (
  invitationId: string,
  email: string,
  actorUserId: string,
  now: Date,
): AuditLogDraft => ({
  occurredAt: now,
  actorId: actorUserId,
  // COND-012 により事務局権限の記録は true とする
  actedAsStaff: true,
  action: AuditLogAction.StaffRoleDecline,
  targetId: invitationId,
  groupId: null,
  changes: {
    ...toIdentityChanges({ email }),
    status: {
      before: InvitationStatus.Pending,
      after: InvitationStatus.Rejected,
    },
  },
});

/**
 * #29 事務局権限の剥奪（staff_role.revoke）の操作履歴ドラフトを生成する。
 */
export const toStaffRoleRevokeAuditLog = (
  targetUserId: string,
  actorUserId: string,
  now: Date,
): AuditLogDraft => ({
  occurredAt: now,
  actorId: actorUserId,
  actedAsStaff: true,
  action: AuditLogAction.StaffRoleRevoke,
  targetId: targetUserId,
  groupId: null,
  changes: {
    is_staff: {
      before: true,
      after: false,
    },
  },
});
