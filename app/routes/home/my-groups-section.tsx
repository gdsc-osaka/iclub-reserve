import { Users } from "lucide-react";
import { Link } from "react-router";

import type { MyGroup } from "~/components/group/my-group";
import { MyGroupCard, NoGroupsCard } from "~/components/group/my-group-card";
import { Button } from "~/components/ui/button";

/**
 * ダッシュボードに並べる団体の上限。
 *
 * ダッシュボードは要約と入口なので、PC で 2 列 × 2 行に収まる数にとどめる。
 * すべての団体は所属団体一覧（/groups、SCR-008）で見る。
 */
const DASHBOARD_GROUP_LIMIT = 4;

/**
 * ダッシュボードの所属団体区画。
 *
 * 上限を超える分は出さず、見出しの「すべて見る（全 n 件）」から /groups へ案内する。
 *
 * 団体を読めなかったときは、この区画には何も出さない（`isUnavailable`）。
 * 読めなかっただけなのに「所属していません」と出すと、
 * 招待されているのに外されたように見えてしまう。理由は呼び出し元が上に出す。
 */
export function MyGroupsSection({
  groups,
  isUnavailable,
}: Readonly<{ groups: readonly MyGroup[]; isUnavailable: boolean }>) {
  const displayedGroups = groups.slice(0, DASHBOARD_GROUP_LIMIT);
  const hasMore = groups.length > DASHBOARD_GROUP_LIMIT;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users aria-hidden className="size-4" />
          所属団体
        </h2>
        {groups.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link to="/groups">
              {hasMore ? `すべて見る（全 ${groups.length} 件）` : "すべて見る"}
            </Link>
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        !isUnavailable && <NoGroupsCard />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {displayedGroups.map((group) => (
            <li key={group.id}>
              <MyGroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
