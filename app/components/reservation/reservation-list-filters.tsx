import { Link, useNavigate } from "react-router";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import type {
  ReservationListFacility,
  ReservationStatusCounts,
} from "~/query/reservation/reservation-list";
import type { UserGroupList, UserGroupListItem } from "~/query/user/user-group-list";
import {
  toReservationListPath,
  type ParsedReservationListParams,
} from "~/routes/reservations/list/query-params";
import type { ReservationListStatusFilter } from "~/usecases/reservation/get-reservation-list";

interface ReservationListFiltersProps {
  readonly groups: UserGroupList;
  readonly selectedGroup: UserGroupListItem | null;
  readonly counts: ReservationStatusCounts;
  readonly facilities: readonly ReservationListFacility[];
  readonly params: ParsedReservationListParams;
  readonly scope: "own" | "all";
}

const statusTabs: readonly {
  readonly key: ReservationListStatusFilter;
  readonly label: string;
  readonly countKey: keyof ReservationStatusCounts;
}[] = [
  { key: "all", label: "すべて", countKey: "all" },
  { key: "provisional", label: "仮予約", countKey: "provisional" },
  { key: "approved", label: "承認済み", countKey: "approved" },
  { key: "ended", label: "終了", countKey: "ended" },
];

/**
 * 予約一覧の絞り込み UI コンポーネント。
 *
 * - 団体切り替え（所属が 2 団体以上の場合のみ）
 * - ステータス別件数付きピルタブ（すべて / 仮予約 / 承認済み / 終了）
 * - 施設・設備の選択 Select
 * - 期間（これからの予約 / 過去の予約）の選択 Select
 */
export function ReservationListFilters({
  groups,
  selectedGroup,
  counts,
  facilities,
  params,
  scope,
}: Readonly<ReservationListFiltersProps>) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-3">
      {/* 1. 団体の切り替え（/reservations で所属が 2 件以上のときだけ出す） */}
      {scope === "own" && groups.length >= 2 && (
        <nav
          aria-label="団体の切り替え"
          className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="flex w-max gap-2">
            {groups.map((group) => {
              const isCurrent = group.id === selectedGroup?.id;

              return (
                <li key={group.id}>
                  <Link
                    to={toReservationListPath({ ...params, group: group.id }, "own")}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {group.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* 2. ステータス切り替えピルと期間・施設の Select */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* ステータス別ピル */}
        <nav
          aria-label="ステータスの絞り込み"
          className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="flex w-max gap-1.5">
            {statusTabs.map((tab) => {
              const isCurrent = params.status === tab.key;
              const count = counts[tab.countKey];

              return (
                <li key={tab.key}>
                  <Link
                    to={toReservationListPath({ ...params, status: tab.key }, scope)}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground font-medium"
                        : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.2 text-xs",
                        isCurrent
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 施設・設備と期間の Select */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 施設・設備 Select */}
          <div className="w-48">
            <Select
              value={params.facility ?? "all"}
              onValueChange={(val) => {
                const nextFacility = val === "all" ? null : val;
                void navigate(toReservationListPath({ ...params, facility: nextFacility }, scope));
              }}
            >
              <SelectTrigger aria-label="施設・設備で絞り込み" className="w-full">
                <SelectValue placeholder="すべての施設・設備" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">すべての施設・設備</SelectItem>
                  {facilities.map((fac) => (
                    <SelectItem key={fac.id} value={fac.id}>
                      {fac.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* 期間 Select */}
          <div className="w-40">
            <Select
              value={params.period}
              onValueChange={(val) => {
                void navigate(
                  toReservationListPath({ ...params, period: val as "upcoming" | "past" }, scope),
                );
              }}
            >
              <SelectTrigger aria-label="期間で絞り込み" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="upcoming">これからの予約</SelectItem>
                  <SelectItem value="past">過去の予約</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
