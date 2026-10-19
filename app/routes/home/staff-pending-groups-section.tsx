import { Building2, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { formatMonthDay } from "~/lib/date";
import type { GroupSearchItem } from "~/query/group/group-search";
import { toStaffGroupPath } from "~/routes/groups/staff/query-params";
import { SectionUnavailableAlert } from "./section-unavailable-alert";

export interface StaffPendingGroupsSectionProps {
  /** 登録が古い順に最大 5 件 */
  readonly groups: readonly GroupSearchItem[];
  /** 有効化を待っている団体の総数（5 件を超えた分も含む） */
  readonly totalCount: number;
  readonly isUnavailable: boolean;
}

/**
 * 事務局のダッシュボードの「有効化を待っている団体」（SCR-022 / UC-014）。
 *
 * 待たせている団体から片付けられるよう、登録が古い順に並べる。
 * 団体を選ぶと団体管理画面（SCR-007）でメンバーを確かめられる。
 * 有効化は、確認のダイアログがある団体一覧（SCR-008）で行うので、ここには操作を置かない。
 */
export function StaffPendingGroupsSection({
  groups,
  totalCount,
  isUnavailable,
}: Readonly<StaffPendingGroupsSectionProps>) {
  return (
    <section aria-labelledby="staff-pending-groups-title" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="staff-pending-groups-title" className="flex items-center gap-2 font-semibold">
            <Building2 aria-hidden className="size-4.5 text-muted-foreground" />
            有効化を待っている団体
          </h2>
          <p className="text-xs text-muted-foreground">登録が古い順</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-9 text-xs">
          <Link to={toStaffGroupPath({ status: "pending" })}>
            {/* 読めなかったときに「0 件」と出すと、待っている団体が無いと読み違えるので件数を付けない */}
            {isUnavailable ? "すべて見る" : `すべて見る（${totalCount} 件）`}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="有効化を待っている団体" forStaff />}

      {!isUnavailable && groups.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          有効化を待っている団体はありません
        </p>
      )}

      {groups.length > 0 && (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                to={`/groups/${group.id}`}
                className="flex items-center gap-3 p-3.5 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-semibold wrap-anywhere">{group.name}</span>
                  <span className="text-sm text-muted-foreground">
                    メンバー {group.memberCount} 人 · {formatMonthDay(group.createdAt)} 登録
                  </span>
                </div>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
