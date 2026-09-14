import { RESERVATION_STEP_MINUTES } from "~/domain/reservation";
import {
  formatMonthDay,
  formatTimeRange,
  isSameTokyoDay,
  tokyoMinutesOfDay,
  toTokyoTimeKey,
} from "~/lib/date";
import { cn } from "~/lib/utils";

import {
  axisHours,
  blockStyle,
  CLOSE_MINUTES,
  OPEN_MINUTES,
  toAxisPercent,
} from "./availability-week";
import { reservationStatusLabel } from "./reservation-status-badge";
import { startSlotMinutes, type SlotRange, type TimelineReservation } from "./reservation-slots";
import { layoutTimelineItems } from "./timeline-layout";

/**
 * 30 分枠 1 つ分の高さ（rem）。
 *
 * 空き状況カレンダー（SCR-001）の 1 時間枠（2.75rem）より少し詰めている。
 * あちらは 7 日分を 1 画面に収める必要があるが、こちらは 1 日分だけなので、
 * 30 分枠でも予約の帯に時刻と団体名を 2 行で入れられる。
 */
const SLOT_HEIGHT_REM = 1.5;

/** タイムライン全体の高さ（rem）。利用可能時間と枠の刻みだけで決まる */
const TIMELINE_HEIGHT_REM = startSlotMinutes.length * SLOT_HEIGHT_REM;

/**
 * 1 日分のタイムライン（SCR-002 の日時選択）。
 *
 * 空き状況カレンダー（SCR-001）と同じ縦軸・同じ配色にしてある。
 * 申請の直前に見る図が別物になると、カレンダーで見た空き具合と
 * フォームで見た空き具合が同じものだと気づけない。
 *
 * 枠を押して時間帯を選ぶが、フォームが実際に送るのは
 * 呼び出し側が持っている開始・終了の `<select>` の値。
 * この図は「選択肢を絵で選べるようにしたもの」であって、入力そのものではない。
 * こうしておくと、JavaScript が動かない環境でも申請できる。
 */
export function ReservationTimeline({
  day,
  now,
  items,
  blockedSlots,
  pastSlots,
  range,
  disabled,
  onSelectSlot,
}: Readonly<{
  /** 描く日（日本時間のその日のどこかを指す Date） */
  day: Date;
  /** ローダーが読んだ現在時刻。今日なら「いま」の線を引く */
  now: Date;
  /** その日・その施設に入っている予約 */
  items: readonly TimelineReservation[];
  /** 承認済みの予約で塞がっている枠（COND-001） */
  blockedSlots: ReadonlySet<number>;
  /** すでに過ぎてしまった枠 */
  pastSlots: ReadonlySet<number>;
  /** いま選んでいる時間帯 */
  range: SlotRange | null;
  /** 申請できない状態のときに、枠を押せなくする */
  disabled: boolean;
  onSelectSlot: (slotStartMinutes: number) => void;
}>) {
  const placements = layoutTimelineItems(items);
  const isToday = isSameTokyoDay(day, now);
  const nowMinutes = tokyoMinutesOfDay(now);

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)]">
      <div className="relative" style={{ height: `${TIMELINE_HEIGHT_REM}rem` }}>
        {axisHours.map((hour) => {
          const isFirst = hour === axisHours.at(0);
          const isLast = hour === axisHours.at(-1);

          return (
            <span
              key={hour}
              className="absolute right-2 text-[11px] tabular-nums text-muted-foreground"
              style={{
                top: `${toAxisPercent(hour * 60 - OPEN_MINUTES)}%`,
                // 目盛りの線に文字の中心を合わせる。両端だけは枠からはみ出すのでずらさない
                transform: isFirst ? "none" : isLast ? "translateY(-100%)" : "translateY(-50%)",
              }}
            >
              {hour}:00
            </span>
          );
        })}
      </div>

      <div
        className="relative overflow-hidden rounded-md border bg-card"
        style={{ height: `${TIMELINE_HEIGHT_REM}rem` }}
      >
        <div
          className="grid h-full"
          style={{ gridTemplateRows: `repeat(${startSlotMinutes.length}, minmax(0, 1fr))` }}
        >
          {startSlotMinutes.map((slot, index) => {
            const isBlocked = blockedSlots.has(slot);
            const isPast = pastSlots.has(slot);
            const label = toTokyoTimeKey(slot);

            return (
              <button
                key={slot}
                type="button"
                disabled={disabled || isBlocked || isPast}
                onClick={() => onSelectSlot(slot)}
                aria-label={
                  isBlocked
                    ? `${formatMonthDay(day)} ${label} は承認済みの予約で埋まっています`
                    : isPast
                      ? `${formatMonthDay(day)} ${label} は過ぎています`
                      : `${formatMonthDay(day)} ${label} を選ぶ`
                }
                className={cn(
                  "border-b transition-colors last:border-b-0",
                  "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "disabled:pointer-events-none",
                  // 30 分の線は薄く、1 時間の線ははっきり引いて、時刻を数えやすくする
                  index % 2 === 1 ? "border-border" : "border-border/40",
                  // 過ぎた時間は塗りつぶして、選べないことが色でも分かるようにする
                  isPast && "bg-muted/50",
                )}
              />
            );
          })}
        </div>

        {isToday && nowMinutes >= OPEN_MINUTES && nowMinutes <= CLOSE_MINUTES && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t-2 border-destructive/70"
            style={{ top: `${toAxisPercent(nowMinutes - OPEN_MINUTES)}%` }}
          />
        )}

        {range !== null && (
          /*
           * 選んでいる時間帯。下の枠を押せるように、この帯自体はクリックを受け取らない。
           * 受け取るようにすると、選び直したいときに一度選択を消す操作が要る。
           */
          <div
            className="pointer-events-none absolute inset-x-0 z-10 rounded-md border-2 border-primary bg-primary/15 px-1.5 py-0.5"
            style={{
              top: `${toAxisPercent(range.startMinutes - OPEN_MINUTES)}%`,
              height: `${toAxisPercent(range.endMinutes - range.startMinutes)}%`,
            }}
          >
            <p className="truncate text-[11px] leading-tight font-medium text-primary tabular-nums">
              {toTokyoTimeKey(range.startMinutes)}〜{toTokyoTimeKey(range.endMinutes)}
            </p>
          </div>
        )}

        {placements.map(({ item, column, columnCount }) => {
          const { reservation } = item;
          const style = blockStyle(reservation.status, reservation.isOwnGroup);
          const timeRange = formatTimeRange(reservation.startAt, reservation.endAt);
          const statusLabel = reservationStatusLabel[reservation.status];

          return (
            /*
             * 入っている予約。押しても何も起きない図なので、クリックは下の枠へ通す。
             * 仮予約とは重なって申請できるため（COND-001）、
             * 帯の上を押したときも、その時間帯を選べる必要がある。
             */
            <div
              key={reservation.id}
              className={cn(
                "pointer-events-none absolute overflow-hidden rounded-md border px-1.5 py-0.5",
                style.box,
              )}
              style={{
                top: `${toAxisPercent(item.startMinutes - OPEN_MINUTES)}%`,
                height: `${toAxisPercent(item.endMinutes - item.startMinutes)}%`,
                left: `calc(${(column / columnCount) * 100}% + 2px)`,
                width: `calc(${100 / columnCount}% - 4px)`,
                minHeight: "1.25rem",
              }}
              title={`${timeRange}｜${reservation.groupName}｜${statusLabel}`}
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-0.5", style.rail)} />

              <p className="truncate text-[11px] leading-tight font-medium tabular-nums">
                {timeRange}
              </p>
              <p className="truncate text-[11px] leading-tight opacity-80">
                {reservation.groupName}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * タイムラインの色の意味と、操作の仕方の説明。
 *
 * 「押すと選べる」「もう一度押すと伸びる」は見ただけでは分からないので、
 * 凡例と同じ場所に書いている。
 */
export function ReservationTimelineLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-sm border-2 border-primary bg-primary/15" />
        選んでいる時間
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-sm border border-primary/40 bg-primary/20" />
        承認済み（選べません）
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-3 rounded-sm border border-dashed border-amber-500/50 bg-amber-500/20"
        />
        仮予約（重ねて申請できます）
      </li>
      <li className="w-full sm:w-auto">
        枠を押すと {RESERVATION_STEP_MINUTES} 分選べます。後ろの枠をもう一度押すと伸びます。
      </li>
    </ul>
  );
}
