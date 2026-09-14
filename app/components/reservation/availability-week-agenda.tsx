import { Plus } from "lucide-react";

import { formatMonthDay, formatTimeRange } from "~/lib/date";
import { cn } from "~/lib/utils";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { blockStyle, toDayBlocks, type AvailabilityDay } from "./availability-week";
import { ReservationStatusBadge } from "./reservation-status-badge";

/**
 * 1 週間分の予約を日ごとに縦に並べたもの（スマホ向け）。
 *
 * 縦長の画面で 7 日 × 12 時間の表を出すと、1 時間が数ミリしか取れず
 * 隣の枠を押し間違える。そのため時間軸を捨てて、予約を一覧にしている。
 * 時刻は文字で読めるので、空き時間の把握には足りる。
 *
 * 日付ごとに「＋」を置いているのは、空き時間帯そのものを押させないため。
 * 細い帯を狙わせるより、確実に押せる的を用意して、
 * 時刻は申請フォームで選んでもらうほうが間違いが少ない。
 */
export function AvailabilityWeekAgenda({
  days,
  reservations,
  canApply,
  onSelectDay,
}: Readonly<{
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  /** 申請へ進めるかどうか（COND-006） */
  canApply: boolean;
  onSelectDay: (day: AvailabilityDay) => void;
}>) {
  return (
    <ul className="divide-y">
      {days.map((day) => (
        <li key={day.dateKey} className="py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className={cn("text-sm font-medium", day.isToday && "text-primary")}>
              {formatMonthDay(day.date)}
              {day.isToday && <span className="ml-2 text-xs">今日</span>}
            </h3>

            {canApply && (
              <button
                type="button"
                onClick={() => onSelectDay(day)}
                aria-label={`${formatMonthDay(day.date)} の仮予約を申請`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            )}
          </div>

          <DayReservations day={day} reservations={reservations} />
        </li>
      ))}
    </ul>
  );
}

/** その日に入っている予約の一覧。1 件も無ければ空いていることを書く。 */
function DayReservations({
  day,
  reservations,
}: Readonly<{ day: AvailabilityDay; reservations: readonly AvailabilityReservation[] }>) {
  const blocks = toDayBlocks(day, reservations);

  if (blocks.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">終日空いています</p>;
  }

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {blocks.map(({ reservation }) => {
        const style = blockStyle(reservation.status, reservation.isOwnGroup);

        return (
          <li
            key={reservation.id}
            className={cn("relative overflow-hidden rounded-md border py-2 pr-3 pl-3", style.box)}
          >
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.rail)} />

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/*
               * 日をまたぐ予約は 2 日ぶんの欄に出るので、時刻だけで書くと
               * どちらの欄でも「20:00〜10:00」と逆向きに見える。
               * 表記はカレンダーの帯と同じ関数に任せる。
               */}
              <span className="text-sm font-medium tabular-nums">
                {formatTimeRange(reservation.startAt, reservation.endAt)}
              </span>
              <ReservationStatusBadge status={reservation.status} />
              {reservation.isOwnGroup && (
                <span className="text-xs text-muted-foreground">自団体</span>
              )}
            </div>

            <p className="mt-1 truncate text-sm">{reservation.groupName}</p>

            {/*
             * 使用人数と備考は自団体のメンバーと事務局にしか渡していない（COND-008）。
             * 他団体の予約では detail が null になるので、ここは描かれない。
             */}
            {reservation.detail !== null && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {reservation.detail.headCount} 名
                {reservation.detail.note !== null && `／${reservation.detail.note}`}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
