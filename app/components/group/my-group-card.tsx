import { ChevronRight, Users } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";

import { GroupStatusBadge } from "./group-status-badge";
import type { MyGroup } from "./my-group";

/**
 * 所属している団体 1 件分のカード。押すとその団体の画面（/groups/:groupId）へ移動する。
 *
 * ダッシュボード（/）と所属団体一覧（/groups）の両方で同じ部品を使い、見た目を食い違わせない。
 * 承認待ちの説明はカードには書かず、一覧の上の `PendingGroupsNotice` にまとめて出す。
 */
export function MyGroupCard({ group }: Readonly<{ group: MyGroup }>) {
  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex h-full items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">{group.name}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <GroupStatusBadge status={group.status} />
          {group.isAdmin && <span>管理者</span>}
          <span className="flex items-center gap-1">
            <Users aria-hidden className="size-3.5" />
            メンバー {group.memberCount} 人
          </span>
        </div>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * どの団体にも所属していない人に出す案内。
 *
 * ダッシュボード（/）と所属団体一覧（/groups）の両方で同じ部品を使う。
 */
export function NoGroupsCard() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">まだどの団体にも所属していません</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        団体に招待されると、ここに表示されます。
      </p>
      <div className="mt-4">
        <Button asChild size="sm">
          <Link to="/groups/new">団体を登録</Link>
        </Button>
      </div>
    </div>
  );
}
