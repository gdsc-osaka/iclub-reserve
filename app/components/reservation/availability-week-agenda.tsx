import { Plus } from "lucide-react";

import { formatMonthDay, formatMonthDayParts, formatTimeRange } from "~/lib/date";
import { cn } from "~/lib/utils";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

import { AvailabilityDraftCard } from "./availability-detail-card";
import {
  blockStyle,
  isPastDay,
  toDayBlocks,
  weekdayStyle,
  type AvailabilityDay,
} from "./availability-week";
import { ReservationStatusBadge } from "./reservation-status-badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Badge } from "../ui/badge";

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
  facility,
  now,
  canApply,
}: Readonly<{
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  /** いま見ている施設・設備。「＋」から申請へ持っていく初期値に使う */
  facility: AvailabilityFacility;
  /** ローダーが読んだ現在時刻。申請できる枠が残っている日かの判定に使う */
  now: Date;
  /** 申請へ進めるかどうか（COND-006） */
  canApply: boolean;
}>) {
  return (
    <ul className="divide-y">
      {days.map((day) => {
        const weekday = weekdayStyle(day.weekday);
        const { monthDay, weekday: weekdayLabel } = formatMonthDayParts(day.date);

        return (
          <li key={day.dateKey} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className={cn("text-sm font-medium", day.isToday && "text-primary")}>
                {monthDay}
                {/*
                 * 色を付けるのは曜日だけ。日付の数字まで赤や青にすると、
                 * その日付が誤っているように見えてしまう。
                 * 今日は見出しごと色を変えているので、ここでは足さない。
                 */}
                <span className={cn(!day.isToday && weekday.label)}>({weekdayLabel})</span>
                {day.isToday && <span className="ml-2 text-xs">今日</span>}
              </h3>

              {/*
               * 申請できる枠が残っていない日には「＋」を出さない。
               * 時刻を選ばずに日付だけを渡す導線なので、その日の枠がすべて
               * 過ぎていると、フォームへ進んでも選べるものが 1 つも無い。
               */}
              {canApply && !isPastDay(day, now) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      aria-label={`${formatMonthDay(day.date)} の仮予約を申請`}
                      size="icon"
                      variant="secondary"
                    >
                      <Plus />
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent align="end" className="w-72">
                    <AvailabilityDraftCard draft={{ facility, day, startHour: null }} />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <DayReservations day={day} reservations={reservations} />
          </li>
        );
      })}
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
              {reservation.isOwnGroup && <Badge>自団体</Badge>}
            </div>

            {/* 自団体の団体名は太字にする。色の濃さだけでは自分たちの予約を見つけにくい */}
            <p className={cn("mt-1 text-sm", reservation.isOwnGroup && "font-medium")}>
              {reservation.groupName}
            </p>

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
