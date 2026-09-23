/**
 * 所属団体一覧（SCR-008）およびダッシュボードに出す団体の形と、そこへの変換。
 *
 * 画面を描かずに確かめられるように、React に触れるものは置かない。
 */

import type { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { UserGroupListItem } from "~/query/user/user-group-list";

/** 画面に出す所属団体 1 件分。 */
export interface MyGroup {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  /** その団体の管理者かどうか。メンバーの招待などができる。 */
  readonly isAdmin: boolean;
  /** その団体のメンバー数 */
  readonly memberCount: number;
}

/**
 * クエリから取得した団体の 1 件を、画面に出す形へ変換する。
 *
 * 役割の判定（管理者かどうか）をここで集約し、画面側での役割判定の分散を防ぐ。
 */
export const toMyGroup = (group: UserGroupListItem): MyGroup => ({
  id: group.id,
  name: group.name,
  status: group.status,
  isAdmin: group.role === MembershipRole.Admin,
  memberCount: group.memberCount,
});
