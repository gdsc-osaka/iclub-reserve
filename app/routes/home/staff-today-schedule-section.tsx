import { CalendarDays } from "lucide-react";
import { Link } from "react-router";

import {
  blockStyle,
  CLOSE_MINUTES,
  OPEN_MINUTES,
  slotHours,
  toAxisPercent,
  toDayBlocks,
} from "~/components/reservation/availability-week";
import {
  reservationStatusLabel,
  ReservationStatusBadge,
} from "~/components/reservation/reservation-status-badge";
import { layoutTimelineItems } from "~/components/reservation/timeline-layout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { reservationDetailPath, ReservationStatus } from "~/domain/reservation";
import { formatTimeRange, startOfTokyoDay, tokyoMinutesOfDay } from "~/lib/date";
import { cn } from "~/lib/utils";
import type {
  TodayScheduleFacility,
  TodayScheduleReservation,
} from "~/query/reservation/staff-today-schedule";

export interface StaffTodayScheduleSectionProps {
  readonly facilities: readonly TodayScheduleFacility[];
  readonly reservations: readonly TodayScheduleReservation[];
  readonly isUnavailable: boolean;
  /** 今の時刻。時刻の線と「利用中」の判定に使う。サーバーとブラウザで食い違わないよう loader で決める */
  readonly now: Date;
}

/**
 * 事務局のダッシュボードの「今日の予約状況」（SCR-022 / UC-001）。
 *
 * PC では施設を縦・時間を横に並べた 1 日分のタイムライン、スマホでは時刻順の一覧にする。
 * 横に並べると、スマホの幅では 1 時間が指 1 本より細くなり、帯を押し分けられないため。
 */
export function StaffTodayScheduleSection({
  facilities,
  reservations,
  isUnavailable,
  now,
}: Readonly<StaffTodayScheduleSectionProps>) {
  return (
    <section aria-labelledby="today-schedule-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="today-schedule-title" className="flex items-center gap-2 font-semibold">
          <CalendarDays aria-hidden className="size-4.5 text-muted-foreground" />
          今日の予約状況
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* 凡例。帯の色はタイムラインにしか無いので、一覧を出すスマホ幅では出さない */}
          <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
            <LegendSwatch status={ReservationStatus.Approved} />
            <LegendSwatch status={ReservationStatus.Provisional} />
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-3 border-l-2 border-destructive/70" />
              今の時刻
            </span>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link to="/availability">空き状況で見る</Link>
          </Button>
        </div>
      </div>

      {isUnavailable && (
        <Alert variant="destructive">
          <AlertTitle>今日の予約状況を読み込めませんでした</AlertTitle>
          <AlertDescription>
            時間をおいて、画面を再読み込みしてください。
            繰り返し表示される場合はシステム管理者にご連絡ください。
          </AlertDescription>
        </Alert>
      )}

      {!isUnavailable && facilities.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          有効な施設・設備がありません
        </p>
      )}

      {!isUnavailable && facilities.length > 0 && (
        <>
          <div className="hidden md:block">
            <TodayTimeline facilities={facilities} reservations={reservations} now={now} />
          </div>
          <div className="md:hidden">
            <TodayList reservations={reservations} now={now} />
          </div>
        </>
      )}
    </section>
  );
}

/** 凡例の 1 項目。色は空き状況の画面の帯（`blockStyle`）とそろえる */
function LegendSwatch({ status }: Readonly<{ status: ReservationStatus }>) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3 rounded-sm border", blockStyle(status, true).box)} />
      {reservationStatusLabel[status]}
    </span>
  );
}

/** 時間の列の並べ方。1 時間を 1 列にする */
const hourColumns = { gridTemplateColumns: `repeat(${slotHours.length}, minmax(0, 1fr))` };

/**
 * PC 向けの 1 日分のタイムライン（施設が縦、時間が横）。
 *
 * 横幅が足りないときは、この中だけを横に動かせるようにする（画面全体は動かさない）。
 */
function TodayTimeline({
  facilities,
  reservations,
  now,
}: Readonly<{
  facilities: readonly TodayScheduleFacility[];
  reservations: readonly TodayScheduleReservation[];
  now: Date;
}>) {
  const today = { date: startOfTokyoDay(now) };
  const nowMinutes = tokyoMinutesOfDay(now);
  const showNowLine = nowMinutes >= OPEN_MINUTES && nowMinutes <= CLOSE_MINUTES;
  const nowLeft = `${toAxisPercent(nowMinutes - OPEN_MINUTES)}%`;

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[48rem]">
        {/* 時刻の目盛り */}
        <div className="flex border-b bg-muted/30">
          <div className="w-36 shrink-0 border-r px-3 py-2 text-xs font-medium text-muted-foreground">
            施設・設備
          </div>
          <div className="grid flex-1 text-xs text-muted-foreground" style={hourColumns}>
            {slotHours.map((hour) => (
              <div key={hour} className="border-r px-1 py-2 last:border-r-0">
                {hour}:00
              </div>
            ))}
          </div>
        </div>

        <div className="divide-y">
          {facilities.map((facility) => {
            /*
             * 空き状況の画面と同じく、利用可能時間の外にはみ出す部分は帯の位置だけを切り詰め、
             * 同じ時間帯に重なった予約は上下に分けて置く（仮予約どうしは重なってよいため。COND-001）
             */
            const blocks = toDayBlocks(
              today,
              reservations.filter((reservation) => reservation.facilityId === facility.id),
            );
            const placements = layoutTimelineItems(blocks);

            return (
              <div key={facility.id} className="flex min-h-16">
                <div className="flex w-36 shrink-0 items-center border-r px-3 py-2 text-xs font-semibold">
                  <span className="truncate" title={facility.name}>
                    {facility.name}
                  </span>
                </div>

                <div className="relative flex-1">
                  {/* 1 時間ごとの区切り線 */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 grid"
                    style={hourColumns}
                  >
                    {slotHours.map((hour) => (
                      <div key={hour} className="border-r border-border/50 last:border-r-0" />
                    ))}
                  </div>

                  {placements.map(({ item: block, column, columnCount }) => {
                    const { reservation } = block;
                    // 帯に出す時刻は、切り詰めた位置ではなく予約そのものの値を使う
                    const timeRange = formatTimeRange(reservation.startAt, reservation.endAt);
                    const statusLabel = reservationStatusLabel[reservation.status];

                    return (
                      <Link
                        key={reservation.id}
                        to={reservationDetailPath(reservation.id)}
                        aria-label={`${timeRange} ${reservation.groupName} ${statusLabel} の予約詳細を開く`}
                        title={`${timeRange}｜${reservation.groupName}｜${statusLabel}`}
                        className={cn(
                          "absolute flex items-center overflow-hidden rounded-md border px-1.5 text-[11px] font-medium hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring",
                          blockStyle(reservation.status, true).box,
                        )}
                        style={{
                          left: `${toAxisPercent(block.startMinutes - OPEN_MINUTES)}%`,
                          width: `${toAxisPercent(block.endMinutes - block.startMinutes)}%`,
                          top: `calc(${(column / columnCount) * 100}% + 2px)`,
                          height: `calc(${100 / columnCount}% - 4px)`,
                        }}
                      >
                        <span className="truncate">{reservation.groupName}</span>
                      </Link>
                    );
                  })}

                  {showNowLine && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 border-l-2 border-destructive/70"
                      style={{ left: nowLeft }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * スマホ向けの時刻順の一覧。
 *
 * 終わった予約は省き、省いた数だけを添える。事務局が今日のうちに気にするのは、
 * これから始まる予約と利用中の予約だけだから。
 */
function TodayList({
  reservations,
  now,
}: Readonly<{
  reservations: readonly TodayScheduleReservation[];
  now: Date;
}>) {
  const remaining = reservations.filter((reservation) => reservation.endAt > now);
  const endedCount = reservations.length - remaining.length;

  return (
    <div className="flex flex-col gap-2">
      {remaining.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          {reservations.length === 0 ? "今日の予約はありません" : "今日の予約はすべて終わりました"}
        </p>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          {remaining.map((reservation) => {
            const isInUse = reservation.startAt <= now;

            return (
              <li key={reservation.id}>
                <Link
                  to={reservationDetailPath(reservation.id)}
                  className="flex flex-col gap-1 p-3.5 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatTimeRange(reservation.startAt, reservation.endAt)}
                    </span>
                    {/* 承認済みのバッジと同じ色にすると並んだときに見分けられないので、別の色にする */}
                    {isInUse && (
                      <Badge className="bg-emerald-600 text-white dark:bg-emerald-500">
                        利用中
                      </Badge>
                    )}
                    <ReservationStatusBadge status={reservation.status} />
                  </div>
                  <p className="text-sm">
                    {reservation.facilityName}
                    <span className="text-muted-foreground">
                      {" "}
                      · {reservation.groupName} · {reservation.headCount} 人
                    </span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {endedCount > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          終わった {endedCount} 件は省略しています
        </p>
      )}
    </div>
  );
}
