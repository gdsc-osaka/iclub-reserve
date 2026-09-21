import { ChevronRight, Users } from "lucide-react";
import { Link } from "react-router";

import { GroupStatusBadge } from "~/components/group/group-status-badge";

import type { DashboardGroup } from "./dashboard-group";

/**
 * 所属している団体を並べる区画。
 *
 * 団体を読めなかったときは、この区画には何も出さない（`isUnavailable`）。
 * 読めなかっただけなのに「所属していません」と出すと、
 * 招待されているのに外されたように見えてしまう。理由は呼び出し元が上に出す。
 */
export function MyGroupsSection({
  groups,
  isUnavailable,
}: Readonly<{ groups: readonly DashboardGroup[]; isUnavailable: boolean }>) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users aria-hidden className="size-4" />
        所属団体
      </h2>

      {groups.length === 0 ? (
        !isUnavailable && <NoGroupsCard />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * どの団体にも所属していない人に出す案内。
 *
 * NOTE: 団体の登録（REQ-016）は現在未実装で、事務局が直接データを投入している運用。
 * 団体登録機能が実装されたら、ここに「団体を登録」の導線を足す。
 */
function NoGroupsCard() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">まだどの団体にも所属していません</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        団体に招待されると、ここに表示されます。
        <br />
        新しく団体を登録したいときは、事務局にご連絡ください。
      </p>
    </div>
  );
}

/** 所属している団体 1 件分のカード。押すとその団体の画面へ移動する。 */
function GroupCard({ group }: Readonly<{ group: DashboardGroup }>) {
  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex h-full items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">{group.name}</span>
        <span className="flex items-center gap-2">
          <GroupStatusBadge status={group.status} />
          {group.isAdmin && <span className="text-xs text-muted-foreground">管理者</span>}
        </span>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
