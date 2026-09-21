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

/**
 * member 行の一覧から、管理者である「人数」を数える。
 *
 * 行数ではなく、ユーザー単位で数える点に意味がある。
 * member テーブルには (organization_id, user_id) の一意制約が無いため、
 * 同じ人の行が同じ団体に 2 つある異常なデータが理論上ありえる。
 * 一方で役割の更新・削除は (団体, ユーザー) に一致する行をまとめて書き換えるので、
 * 行数で数えると「管理者は 2 人いる」と誤って判定したまま
 * 1 人分の行をすべて消してしまい、管理者が 0 人になる。
 * 数える単位と、変更する単位をそろえるために Set で重複を畳む。
 */
export const countAdminUsers = (
  rows: readonly { readonly userId: string; readonly role: string }[],
): number => {
  const adminUserIds = new Set<string>();

  for (const row of rows) {
    if (toMembershipRoles(row.role).includes(MembershipRole.Admin)) {
      adminUserIds.add(row.userId);
    }
  }

  return adminUserIds.size;
};
