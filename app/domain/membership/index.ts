import type { PermissionTable } from "../authz";
import { rolesCan } from "../authz";

/**
 * グループにおけるメンバーの役割。
 */
export const MembershipRole = {
  Admin: "admin",
  Member: "member",
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

/**
 * ユーザーがグループに所属していることを表すドメインモデル。
 */
export interface Membership {
  readonly groupId: string;
  readonly userId: string;
  readonly roles: readonly MembershipRole[];
}

/**
 * ユーザーがそのグループで操作を実行できるかを判定する。
 *
 * 所属していない場合は `membership` に null を渡す。null なら必ず false になるので、
 * 「所属していないグループでは何もできない」が判定を書き忘れようのない形で保証される。
 * 認可の判定は、資源側の表を直接読まずに必ずこの関数を通すこと。
 * 各ドメインが `membership !== null` を自前で書く形にすると、
 * いつか書き忘れが起きる。
 *
 * 表そのものは資源ごとのドメインが持つ (app/domain/group.ts の `groupPermissions` など)。
 * ここが知っているのは「Membership が表に対して何を意味するか」だけ。
 */
export const canPerform = <A extends string>(
  table: PermissionTable<MembershipRole, A>,
  membership: Membership | null,
  action: A,
): boolean => membership !== null && rolesCan(table, membership.roles, action);
