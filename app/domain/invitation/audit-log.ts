/**
 * 招待（INFO-007）の操作履歴に関する純粋関数（COND-013）。
 */
import {
  toCreatedChanges,
  toIdentityChanges,
  toUpdatedChanges,
  type AuditLogChanges,
} from "../audit-log";
import type { MembershipRole } from "../membership";
import { InvitationStatus } from "./index";

/**
 * 招待の送信（UC-011 / #17）の変更内容を組み立てる。
 */
export const toInvitationSendChanges = (invitation: {
  readonly email: string;
  readonly role: MembershipRole;
}): AuditLogChanges =>
  toCreatedChanges({
    email: invitation.email,
    role: invitation.role,
  });

/**
 * 招待の取り消し（UC-011 / #18）の変更内容を組み立てる。
 *
 * 承諾されなかった招待でも後から特定できるよう、email と role を固定値として含める（INFO-008）。
 */
export const toInvitationCancelChanges = (
  email: string,
  role: MembershipRole,
): AuditLogChanges => ({
  ...toIdentityChanges({ email, role }),
  ...toUpdatedChanges({ status: InvitationStatus.Pending }, { status: InvitationStatus.Canceled }),
});

/**
 * 招待の承諾（UC-022 / #19）の変更内容を組み立てる。
 */
export const toInvitationAcceptChanges = (
  email: string,
  role: MembershipRole,
): AuditLogChanges => ({
  ...toIdentityChanges({ email, role }),
  ...toUpdatedChanges({ status: InvitationStatus.Pending }, { status: InvitationStatus.Accepted }),
});

/**
 * 招待の辞退（UC-022 / #20）の変更内容を組み立てる。
 */
export const toInvitationRejectChanges = (
  email: string,
  role: MembershipRole,
): AuditLogChanges => ({
  ...toIdentityChanges({ email, role }),
  ...toUpdatedChanges({ status: InvitationStatus.Pending }, { status: InvitationStatus.Rejected }),
});
