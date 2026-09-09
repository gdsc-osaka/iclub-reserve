import { GroupStatus } from "~/domain/group";
import { StatusBadge, StatusTone } from "../status-badge";

/** 団体の状態を利用者向けの日本語にする。 */
export const groupStatusLabel: Record<GroupStatus, string> = {
  [GroupStatus.Enabled]: "活動中",
  [GroupStatus.Pending]: "承認待ち",
  [GroupStatus.Disabled]: "停止中",
};

const groupStatusTone: Record<GroupStatus, StatusTone> = {
  [GroupStatus.Enabled]: StatusTone.Positive,
  // 承認待ちの団体は予約を申請できない (COND-006) ので、待ちの色で気づけるようにする
  [GroupStatus.Pending]: StatusTone.Attention,
  [GroupStatus.Disabled]: StatusTone.Neutral,
};

/** 団体の状態を表すラベル。 */
export function GroupStatusBadge({ status }: Readonly<{ status: GroupStatus }>) {
  return <StatusBadge tone={groupStatusTone[status]} label={groupStatusLabel[status]} />;
}
