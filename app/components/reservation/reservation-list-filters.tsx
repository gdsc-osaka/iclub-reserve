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
import type {
  ReservationListPeriodFilter,
  ReservationListStatusFilter,
} from "~/usecases/reservation/get-reservation-list";

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

const periodOptions: readonly {
  readonly value: ReservationListPeriodFilter;
  readonly label: string;
}[] = [
  { value: "upcoming", label: "これからの予約" },
  { value: "past", label: "過去の予約" },
];

const ALL_FACILITIES_LABEL = "すべての施設・設備";

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
      {/* 長い団体名は見出しの横で省略し、改行させない（固定したブロックが高くなるため） */}
      <SelectTrigger aria-label="団体の切り替え" className="min-w-0 max-w-64">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        {/* 中身を渡しておくと、読み込み直後（サーバーで描いた時点）から団体名が出る */}
        <SelectValue>
          <span className="truncate">{selectedGroup.name}</span>
        </SelectValue>
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
 * そのため横に余裕があればタブの右に Select を並べ、狭ければ Select をタブの上に回す。
 * Select をタブの下に置くと、固定したブロックの下端に区切りが無くなり、
 * 後ろを流れる行が Select の真下で途切れて見える。
 *
 * 並べるかどうかは画面の幅（md:）ではなく、この欄に使える幅（コンテナクエリ @4xl:）で決める。
 * PC でもサイドバーを開くと中身の幅が 256px 減り、1 行に並べるとページが横にはみ出すため。
 *
 * 境目の線は border ではなく内側の影（inset の box-shadow）で引く。
 * 影は子より先に描かれるので、選択中のタブの下線（2px）がそのまま線の上に重なる。
 * border に負のマージンで重ねる形だと、横スクロールする nav の中ではタブの下端が切れる。
 */
export function ReservationListFilters({
  counts,
  facilities,
  params,
  scope,
}: Readonly<ReservationListFiltersProps>) {
  const navigate = useNavigate();

  /*
   * 選んでいる施設・期間の名前。SelectValue に中身を渡しておくと、読み込み直後
   * （サーバーで描いた時点）から値が出る。一覧に無い施設 ID のときは渡さず、Radix に任せる。
   */
  const facilityLabel =
    params.facility === null
      ? ALL_FACILITIES_LABEL
      : facilities.find((fac) => fac.id === params.facility)?.name;
  const periodLabel = periodOptions.find((option) => option.value === params.period)?.label;

  return (
    <div className="@container">
      <div className="flex flex-col-reverse gap-3 @4xl:flex-row @4xl:items-end @4xl:justify-between @4xl:shadow-[inset_0_-1px_0_var(--color-border)]">
        {/*
         * 状態のタブ。URL を変えるリンクなので、Radix の Tabs ではなく nav とリンクで作る。
         * 幅に収まらないときは横にスクロールさせ、スクロールバーは出さない。
         * 縦に並べるときは、固定したブロックの左右の余白（px-4 md:px-6）まで線を伸ばす。
         */}
        <nav
          aria-label="ステータスの絞り込み"
          className="-mx-4 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] md:-mx-6 md:px-6 @4xl:mx-0 @4xl:px-0 @4xl:shadow-none [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max gap-1 @4xl:gap-2">
            {statusTabs.map((tab) => {
              const isCurrent = params.status === tab.key;
              const count = counts[tab.countKey];

              return (
                <li key={tab.key}>
                  <Link
                    to={toReservationListPath({ ...params, status: tab.key }, scope)}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(
                      // タップ領域は 44px 以上
                      "inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
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

        {/* 施設・設備と期間。縦に並べるときは期間を中身の幅にし、残りを施設・設備に回す */}
        <div className="flex items-center gap-2 @4xl:pb-2">
          <div className="min-w-0 flex-1 @4xl:w-48 @4xl:flex-none">
            <Select
              value={params.facility ?? "all"}
              onValueChange={(val) => {
                const nextFacility = val === "all" ? null : val;
                void navigate(toReservationListPath({ ...params, facility: nextFacility }, scope));
              }}
            >
              <SelectTrigger aria-label="施設・設備で絞り込み" className={filterTriggerClassName}>
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder={ALL_FACILITIES_LABEL}>{facilityLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{ALL_FACILITIES_LABEL}</SelectItem>
                  {facilities.map((fac) => (
                    <SelectItem key={fac.id} value={fac.id}>
                      {fac.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="shrink-0 @4xl:w-40">
            <Select
              value={params.period}
              onValueChange={(val) => {
                void navigate(
                  toReservationListPath(
                    { ...params, period: val as ReservationListPeriodFilter },
                    scope,
                  ),
                );
              }}
            >
              <SelectTrigger aria-label="期間で絞り込み" className={filterTriggerClassName}>
                <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                <SelectValue>{periodLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {periodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
