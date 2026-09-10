import { GroupStatus } from "~/domain/group";
import { cn } from "~/lib/utils";

/**
 * グループの状態を利用者向けの日本語にする。
 *
 * 表示名は必ずここを通すこと。画面ごとに文字列を書くと、
 * 同じ状態が「承認待ち」「申請中」のように場所によって違う名前で出てしまう。
 */
export const groupStatusLabel: Record<GroupStatus, string> = {
  [GroupStatus.Enabled]: "活動中",
  [GroupStatus.Pending]: "承認待ち",
  [GroupStatus.Disabled]: "停止中",
};

/** 状態ごとの配色。活動中だけを目立たせ、承認待ちは注意を促す色にする。 */
const groupStatusStyle: Record<GroupStatus, { readonly badge: string; readonly dot: string }> = {
  [GroupStatus.Enabled]: {
    badge: "bg-primary/10 text-primary ring-primary/20",
    dot: "bg-primary",
  },
  [GroupStatus.Pending]: {
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  [GroupStatus.Disabled]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
};

/** グループの状態をひと目で分かるようにする小さなラベル。 */
export function GroupStatusBadge({
  status,
  className,
}: Readonly<{ status: GroupStatus; className?: string }>) {
  const style = groupStatusStyle[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {groupStatusLabel[status]}
    </span>
  );
}
