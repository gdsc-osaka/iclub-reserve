import { groupMemberTable } from "~/db/schema";
import { isMembershipRole, MembershipRole, type Membership } from "~/domain/membership";

type GroupMemberRow = typeof groupMemberTable.$inferSelect;

/**
 * DB の `group_member.role` 列を MembershipRole に変換する。
 *
 * 未知の役割で権限ゼロにすると、自分の団体が見えなくなり利用者からは団体が消えたように見えるため、
 * 安全側に倒して最小権限の Member として扱う。
 */
export const toMembershipRole = (raw: string): MembershipRole => {
  const trimmed = raw.trim();
  return isMembershipRole(trimmed) ? trimmed : MembershipRole.Member;
};

/**
 * DB の group_member 行をドメインモデルへ変換する。
 */
export const toMembership = (row: GroupMemberRow): Membership => ({
  groupId: row.groupId,
  userId: row.userId,
  role: toMembershipRole(row.role),
});
