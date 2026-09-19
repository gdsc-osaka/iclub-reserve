/**
 * ダッシュボード（SCR-000）に出す団体の形と、そこへの変換。
 *
 * ローダーと、それを受け取る部品の両方が使うので、どちらからも読める場所に置いている。
 * 画面を描かずに確かめられるように、React に触れるものは置かない。
 */

import type { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { UserGroupListItem } from "~/query/user/user-group-list";

/** ダッシュボードに出す団体 1 件分。画面で使う項目だけに絞っている。 */
export interface DashboardGroup {
  readonly id: string;
  readonly name: string;
  readonly status: GroupStatus;
  /** その団体の管理者かどうか。メンバーの招待などができる。 */
  readonly isAdmin: boolean;
}

/**
 * 一覧の 1 件を、画面に出す形へ変える。
 *
 * 役割の配列をそのまま画面へ渡さず、ここで「管理者かどうか」まで決めてしまう。
 * 役割が増えたときに、判定の書かれた場所を探し回らずに済む。
 */
export const toDashboardGroup = (group: UserGroupListItem): DashboardGroup => ({
  id: group.id,
  name: group.name,
  status: group.status,
  isAdmin: group.roles.includes(MembershipRole.Admin),
});
