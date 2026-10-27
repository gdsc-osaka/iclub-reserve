import { CalendarClock, ChevronRight } from "lucide-react";
import { Link, useFetcher } from "react-router";

import { ReservationActionDialog } from "~/components/reservation/reservation-action-dialog";
import {
  ReservationOverlapNotice,
  reservationOverlapNotice,
} from "~/components/reservation/reservation-notices";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { isShortNotice, ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import { AppArea } from "~/lib/app-area";
import { formatDaysUntil, formatMonthDay, formatTimeRange, tokyoDaysUntil } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
import type { StaffPendingReservationItem } from "~/query/reservation/staff-pending-reservations";
import type { HomeActionData } from "../home-intent";
import { SectionUnavailableAlert } from "../section-unavailable-alert";

export interface StaffPendingSectionProps {
  /** 開始日時の近い順に最大 5 件 */
  readonly reservations: readonly StaffPendingReservationItem[];
  /** 承認待ちの総数（5 件を超えた分も含む） */
  readonly totalCount: number;
  readonly isUnavailable: boolean;
  readonly now: Date;
}

/**
 * 事務局のダッシュボードの「承認待ちの予約」（SCR-022 / UC-006）。
 *
 * 利用日が近いものから先に片付けられるよう、開始日時の近い順に並べる。
 * 「承認」はその場で行い、「却下…」は理由を入れるダイアログを開く（COND-002）。
 */
export function StaffPendingSection({
  reservations,
  totalCount,
  isUnavailable,
  now,
}: Readonly<StaffPendingSectionProps>) {
  return (
    <section aria-labelledby="staff-pending-title" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="staff-pending-title" className="flex items-center gap-2 font-semibold">
            <CalendarClock aria-hidden className="size-4.5 text-muted-foreground" />
            承認待ちの予約
          </h2>
          <p className="text-xs text-muted-foreground">利用日が近い順</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-9 text-xs">
          <Link to="/staff/reservations">
            {/* 読めなかったときに「0 件」と出すと、承認待ちが無いと読み違えるので件数を付けない */}
            {isUnavailable ? "すべて見る" : `すべて見る（${totalCount} 件）`}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      {isUnavailable && <SectionUnavailableAlert what="承認待ちの予約" forStaff />}

      {!isUnavailable && reservations.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          承認待ちの予約はありません
        </p>
      )}

      {reservations.length > 0 && (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          {reservations.map((item) => (
            <PendingReservationRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 利用日までの日数の印。
 *
 * 7 日を切っている予約（COND-028）は「今日」「明日」「あと n 日」を色付きで目立たせ、
 * それより先は「n 日後」と地味に出す。急ぐものだけが目に入るようにするため。
 */
function DaysUntilBadge({ startAt, now }: Readonly<{ startAt: Date; now: Date }>) {
  if (isShortNotice(startAt, now)) {
    return (
      <Badge className="bg-amber-600 text-white dark:bg-amber-500">
        {formatDaysUntil(startAt, now)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {tokyoDaysUntil(startAt, now)} 日後
    </Badge>
  );
}

/** 承認待ちの仮予約 1 件の行 */
function PendingReservationRow({
  item,
  now,
}: Readonly<{
  item: StaffPendingReservationItem;
  now: Date;
}>) {
  const fetcher = useFetcher<HomeActionData>();

  /*
   * 承認・却下を送ったら、結果を待たずに行を消す。
   * 成功すれば読み直した一覧からも消え、件数のタイルも変わる。
   * 失敗したときは行を戻して、理由を行の下に出す。
   */
  if (fetcher.state !== "idle") return null;

  const formError =
    fetcher.data !== undefined && "formError" in fetcher.data ? fetcher.data.formError : null;

  // 承認済みの予約と重なる仮予約は承認できない（COND-001）。押せないことと、その理由を先に見せる
  const overlapNotice = reservationOverlapNotice({
    status: ReservationStatus.Provisional,
    hasApprovedOverlap: item.hasApprovedOverlap,
    hasProvisionalOverlap: item.hasProvisionalOverlap,
    canApprove: true,
  });

  return (
    <li className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to={toReservationDetailPath(AppArea.Staff, item.id)}
          className="flex flex-wrap items-center gap-2 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <DaysUntilBadge startAt={item.startAt} now={now} />
          <span className="font-semibold">
            {formatMonthDay(item.startAt)} {formatTimeRange(item.startAt, item.endAt)}
          </span>
        </Link>
        <p className="text-sm">
          {item.facilityName}
          <span className="text-muted-foreground">
            {" "}
            · {item.groupName} · {item.headCount} 名 · 申請 {formatMonthDay(item.requestedAt)}
          </span>
        </p>
        <ReservationOverlapNotice notice={overlapNotice} />
        {formError && (
          <p role="alert" className="text-xs text-destructive">
            {formError}
          </p>
        )}
      </div>

      {/* スマホでは行の下に 2 列・全幅で並べる */}
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Approve}
          showGroupName
          fetcher={fetcher}
          disabled={item.hasApprovedOverlap}
          trigger={
            <Button size="sm" disabled={item.hasApprovedOverlap} className="h-9">
              承認
            </Button>
          }
        />
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Reject}
          showGroupName
          fetcher={fetcher}
          trigger={
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              却下…
            </Button>
          }
        />
      </div>
    </li>
  );
}
