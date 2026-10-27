import { Building2, CalendarClock, MessageSquareText, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { formatMonthDay } from "~/lib/date";
import { toStaffGroupPath } from "~/routes/groups/staff/query-params";

/** タイル 1 つ分の件数。読み込めなかったときは null にして、0 件と見分ける */
export interface StaffTileCounts {
  /** 承認待ちの予約。総数と、うち利用日まで 7 日を切っている数（COND-028） */
  readonly pendingReservations: { readonly total: number; readonly shortNotice: number } | null;
  /** 団体からの未読メッセージがある予約の数（COND-026） */
  readonly unreadMessages: number | null;
  /** 有効化を待っている団体の数と、いちばん古い団体（UC-014） */
  readonly pendingGroups: {
    readonly total: number;
    readonly oldest: { readonly name: string; readonly createdAt: Date } | null;
  } | null;
}

/** 下の「団体からの未読メッセージ」の区画へ移るための id */
export const STAFF_UNREAD_SECTION_ID = "staff-unread-messages";

/**
 * 事務局のダッシュボードの件数のタイル 3 つ（SCR-022）。
 *
 * それぞれ押すと、その件数を片付ける画面（または下の区画）へ移る。
 * スマホでも 3 列に並べ、ひと目で全部の件数が見えるようにする。
 */
export function StaffTilesSection({ counts }: Readonly<{ counts: StaffTileCounts }>) {
  const { pendingReservations, unreadMessages, pendingGroups } = counts;

  return (
    <section aria-label="対応が必要な件数" className="grid grid-cols-3 gap-2 sm:gap-4">
      <Tile
        to="/staff/reservations"
        icon={CalendarClock}
        label="承認待ちの予約"
        shortLabel="予約の承認待ち"
        count={pendingReservations?.total ?? null}
      >
        {pendingReservations !== null && pendingReservations.shortNotice > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            うち利用日まで 7 日以内 {pendingReservations.shortNotice} 件
          </span>
        )}
      </Tile>

      <Tile
        to={`#${STAFF_UNREAD_SECTION_ID}`}
        icon={MessageSquareText}
        label="団体からの未読メッセージ"
        shortLabel="未読メッセージ"
        count={unreadMessages}
      />

      <Tile
        to={toStaffGroupPath({ status: "pending" })}
        icon={Building2}
        label="承認待ちの団体"
        shortLabel="団体の承認待ち"
        count={pendingGroups?.total ?? null}
      >
        {pendingGroups?.oldest && (
          <span className="block truncate" title={pendingGroups.oldest.name}>
            {pendingGroups.oldest.name}（{formatMonthDay(pendingGroups.oldest.createdAt)} 登録）
          </span>
        )}
      </Tile>
    </section>
  );
}

/** 件数のタイル 1 つ。全体が 1 つのリンクになる */
function Tile({
  to,
  icon: Icon,
  label,
  shortLabel,
  count,
  children,
}: Readonly<{
  to: string;
  icon: LucideIcon;
  label: string;
  /** スマホ幅で出す短い見出し。3 列に並べると、長い見出しは語の途中で折り返してしまう */
  shortLabel: string;
  /** null は読み込めなかったことを表す */
  count: number | null;
  children?: ReactNode;
}>) {
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:p-4"
    >
      <span className="flex items-start justify-between gap-1 text-xs font-medium text-muted-foreground sm:text-sm">
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
        <Icon aria-hidden className="hidden size-4 shrink-0 sm:block" />
      </span>
      {count === null ? (
        <span className="text-xs text-destructive">読み込めませんでした</span>
      ) : (
        <span className="text-xl font-bold tracking-tight sm:text-3xl">
          {count}
          <span className="ml-1 text-xs font-normal text-muted-foreground sm:text-sm">件</span>
        </span>
      )}
      {children && <span className="text-[11px] text-muted-foreground sm:text-xs">{children}</span>}
    </Link>
  );
}
