import { member } from "~/db/schema";
import { isMembershipRole, MembershipRole, type Membership } from "~/domain/membership";

type MemberRow = typeof member.$inferSelect;

/**
 * DB の `member.role` 列を MembershipRole の配列に変換する。
 *
 * Better Auth は複数の役割を "admin,member" のようにカンマ区切りの 1 文字列で持つ。
 * 単一の役割だと決めつけて実装すると、"admin,member" を持つ人が
 * 自前の判定では権限ゼロなのに Better Auth の API では通る、という
 * 逆転した食い違いが起きるため、ここで配列に開いておく。
 *
 * 知らない役割 (creatorRole を直す前に作られた "owner" など) は捨てる。
 * その結果 1 つも残らなかった場合は、最小権限の Member として扱う。
 * ここを空配列のままにすると、自分が所属しているはずのグループが
 * 閲覧できなくなり、利用者からは「グループが消えた」ように見えてしまう。
 */
export const toMembershipRoles = (raw: string): readonly MembershipRole[] => {
  const roles = raw
    .split(",")
    .map((role) => role.trim())
    .filter(isMembershipRole);

  return roles.length > 0 ? roles : [MembershipRole.Member];
};

/**
 * DB の member 行をドメインモデルへ変換する。
 *
 * 役割の文字列は Better Auth の仕様でカンマ区切りになりうるので、
 * `toMembershipRoles` で配列に開いてから渡す。
 */
export const toMembership = (row: MemberRow): Membership => ({
  groupId: row.organizationId,
  userId: row.userId,
  roles: toMembershipRoles(row.role),
});
