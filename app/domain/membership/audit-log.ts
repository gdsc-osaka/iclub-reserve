/**
 * メンバーシップ（INFO-005）の操作履歴に関する純粋関数（COND-013）。
 */
import { toIdentityChanges, toUpdatedChanges, type AuditLogChanges } from "../audit-log";
import type { MembershipRole } from "./index";

/**
 * メンバーシップのロール変更（UC-012 / #15）の変更内容を組み立てる。
 *
 * 削除された後でも対象ユーザーを特定できるよう、user_id を固定値として含める（INFO-008）。
 */
export const toMembershipRoleChanges = (
  userId: string,
  before: MembershipRole,
  after: MembershipRole,
): AuditLogChanges => ({
  ...toIdentityChanges({ user_id: userId }),
  ...toUpdatedChanges({ role: before }, { role: after }),
});

/**
 * メンバーシップの削除（UC-011 / #16）の変更内容を組み立てる。
 *
 * 削除された対象を後から特定できるよう、user_id を固定値として含め、
 * role は変更前 → null とする（INFO-008）。
 */
export const toMembershipRemoveChanges = (
  userId: string,
  before: MembershipRole,
): AuditLogChanges => ({
  ...toIdentityChanges({ user_id: userId }),
  role: { before, after: null },
});
