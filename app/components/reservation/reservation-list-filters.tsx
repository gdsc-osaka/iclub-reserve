import { cn } from "cn";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { Link, useNavigate } from "react-router";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
  readonly counts: ReservationStatusCounts;
  readonly facilities: readonly ReservationListFacility[];
  readonly params: ParsedReservationListParams;
  readonly scope: "own" | "all";
}

/*
 * 「終了」とは呼ばない。取り消し・却下・キャンセルで終わった予約のことだが、
 * 「終了」だと利用時間が過ぎた予約と読み違えやすい。URL の値（ended）はそのまま。
 */
const statusTabs: readonly {
  readonly key: ReservationListStatusFilter;
  readonly label: string;
  readonly countKey: keyof ReservationStatusCounts;
}[] = [
  { key: "all", label: "すべて", countKey: "all" },
  { key: "provisional", label: "仮予約", countKey: "provisional" },
  { key: "approved", label: "承認済み", countKey: "approved" },
  { key: "ended", label: "キャンセル・却下", countKey: "ended" },
];

/**
 * 施設・期間の Select のトリガー。
 * 選んだ値を伸ばして左に寄せる。既定の中央寄せだと、欄が広いときに値だけがアイコンから離れて浮く。
 */
const filterTriggerClassName = "w-full *:data-[slot=select-value]:flex-1";

/**
 * 見出しの横に置く、団体の切り替え（/reservations のみ）。
 *
 * - 所属が 2 団体以上: Select で切り替える
 * - 所属が 1 団体: 団体名を文字で出すだけ。切り替える先が無いのに、押せるように見せない
 * - 所属が 0 団体: 何も出さない
 *
 * 切り替えても、施設・期間・状態の絞り込みはそのまま残す。
 */
export function ReservationListGroupSwitcher({
  groups,
  selectedGroup,
  params,
}: Readonly<{
  groups: UserGroupList;
  selectedGroup: UserGroupListItem | null;
  params: ParsedReservationListParams;
}>) {
  const navigate = useNavigate();

  if (selectedGroup === null) {
    return null;
  }

  if (groups.length < 2) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="size-4 shrink-0" />
        <span className="max-w-64 truncate">{selectedGroup.name}</span>
      </div>
    );
  }

  return (
    <Select
      value={selectedGroup.id}
      onValueChange={(groupId) => {
        void navigate(toReservationListPath({ ...params, group: groupId }, "own"));
      }}
    >
      <SelectTrigger aria-label="団体の切り替え" className="max-w-64">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        {/* 中身を渡しておくと、読み込み直後（サーバーで描いた時点）から団体名が出る */}
        <SelectValue>{selectedGroup.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * 予約一覧の絞り込み UI コンポーネント。
 *
 * - ステータス別件数付きの下線タブ（すべて / 仮予約 / 承認済み / キャンセル・却下）
 * - 施設・設備の選択 Select
 * - 期間（これからの予約 / 過去の予約）の選択 Select
 *
 * 状態は一覧の表示そのものを切り替えるのでタブ、施設・期間は条件を足すだけなので
 * 小さな Select にして、形で役割を見分けられるようにしている。
 *
 * タブの下線は、見出しごと固定したブロックの下端（一覧との境目）を兼ねる。
 * そのため PC ではタブの右に Select を並べ、スマホでは Select をタブの上に回す。
 * スマホで Select をタブの下に置くと、固定したブロックの下端に区切りが無くなり、
 * 後ろを流れる行が Select の真下で途切れて見える。
 */
export function ReservationListFilters({
  counts,
  facilities,
  params,
  scope,
}: Readonly<ReservationListFiltersProps>) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row md:items-end md:justify-between md:border-b">
      {/*
       * 状態のタブ。URL を変えるリンクなので、Radix の Tabs ではなく nav とリンクで作る。
       * 幅に収まらないスマホでは横にスクロールさせ、スクロールバーは出さない。
       */}
      <nav
        aria-label="ステータスの絞り込み"
        className="-mx-4 overflow-x-auto border-b px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:border-b-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex w-max gap-1 md:gap-2">
          {statusTabs.map((tab) => {
            const isCurrent = params.status === tab.key;
            const count = counts[tab.countKey];

            return (
              <li key={tab.key}>
                <Link
                  to={toReservationListPath({ ...params, status: tab.key }, scope)}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    // タップ領域は 44px 以上。選択中の下線（2px）は境界線（1px）に重ねる
                    "-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                    isCurrent
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs",
                      isCurrent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
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

      {/* 施設・設備と期間。スマホでは期間を中身の幅にし、残りを施設・設備に回す */}
      <div className="flex items-center gap-2 md:pb-2">
        <div className="min-w-0 flex-1 md:w-48 md:flex-none">
          <Select
            value={params.facility ?? "all"}
            onValueChange={(val) => {
              const nextFacility = val === "all" ? null : val;
              void navigate(toReservationListPath({ ...params, facility: nextFacility }, scope));
            }}
          >
            <SelectTrigger aria-label="施設・設備で絞り込み" className={filterTriggerClassName}>
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
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

        <div className="shrink-0 md:w-40">
          <Select
            value={params.period}
            onValueChange={(val) => {
              void navigate(
                toReservationListPath({ ...params, period: val as "upcoming" | "past" }, scope),
              );
            }}
          >
            <SelectTrigger aria-label="期間で絞り込み" className={filterTriggerClassName}>
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
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
  );
}
