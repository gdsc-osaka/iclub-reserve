import { formatMonthDay, formatTimeRange, tokyoMinutesOfDay } from "~/lib/date";
import { cn } from "~/lib/utils";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import {
  axisHours,
  blockStyle,
  CLOSE_MINUTES,
  GRID_MIN_HEIGHT_REM,
  OPEN_MINUTES,
  slotHours,
  toAxisPercent,
  toDayBlocks,
  toOccupiedHours,
  type AvailabilityBlock,
  type AvailabilityDay,
} from "./availability-week";
import { reservationStatusLabel } from "./reservation-status-badge";
import { layoutTimelineItems } from "./timeline-layout";

/** 曜日だけを取り出すための形式。日付の見出しの 1 行目に使う */
const weekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
  weekday: "short",
  timeZone: "Asia/Tokyo",
});

/** 「9/12」の形式。日付の見出しの 2 行目に使う */
const shortDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

/**
 * 1 週間 × 施設 1 件のタイムライン（横長の画面向け）。
 *
 * 縦を時間、横を日付にしているのは、「この施設は今週いつ空いているか」を
 * 1 画面で見比べられるようにするため。
 *
 * 帯は狭くて時刻と団体名しか書けないので、押すと呼び出し側が詳細を出す。
 * 使用人数や備考をすべての帯に書こうとすると、1 時間ぶんの高さ（44px）に
 * 収まらず、どの予約も読めなくなる。
 *
 * スマホでは同じ内容を {@link AvailabilityWeekAgenda} が縦に並べて出す。
 * どちらを出すかは CSS の画面幅だけで決めていて、JavaScript では判定していない。
 */
export function AvailabilityWeekGrid({
  days,
  reservations,
  now,
  canApply,
  selectedReservationId,
  onSelectSlot,
  onSelectReservation,
}: Readonly<{
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  /** ローダーが読んだ現在時刻。今日の列に「いま」の線を引くのに使う */
  now: Date;
  /** 空き枠を押して申請へ進めるかどうか（COND-006） */
  canApply: boolean;
  /** いま詳細を出している予約。押した帯を選択中に見せるために使う */
  selectedReservationId: string | null;
  onSelectSlot: (day: AvailabilityDay, hour: number) => void;
  onSelectReservation: (reservation: AvailabilityReservation) => void;
}>) {
  return (
    /*
     * スクロールするのはこの枠の中だけ。ページ全体は動かさない。
     *
     * 7 日分を並べると狭い画面では潰れてしまうので最低幅を決めてあり、
     * 足りなければ横に送る。縦も、時間軸が潰れない高さを確保して、
     * 足りなければ送る。どちらの向きに送っても、
     * 日付の行と時刻の列は端に貼り付いたまま残る（sticky）。
     */
    <div className="h-full overflow-auto overscroll-contain">
      <div className="grid min-h-full min-w-[48rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] grid-rows-[auto_1fr]">
        {/*
         * 左上の角。縦にも横にも動かさないので、日付の行と時刻の列の
         * どちらが下を通っても隠れないよう、いちばん手前に置く。
         */}
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />

        {days.map((day) => (
          /*
           * 日付の見出しは縦スクロールでも残す。
           * 下を予約の帯が通るので、透けない背景（bg-card）を敷いておく。
           * 今日の色付けは重ねた内側の箱で行う。背景色を 1 つの箱で
           * 兼ねようとすると、半透明の色の下を帯が透けて見えてしまう。
           */
          <div key={day.dateKey} className="sticky top-0 z-20 border-b border-l bg-card">
            <div
              className={cn(
                "h-full py-2 text-center",
                day.isToday && "bg-primary/5 font-medium text-primary",
              )}
            >
              <p className="text-xs text-muted-foreground">{weekdayFormatter.format(day.date)}</p>
              <p className="text-sm">{shortDateFormatter.format(day.date)}</p>
            </div>
          </div>
        ))}

        <HourAxis />

        {days.map((day) => (
          <DayColumn
            key={day.dateKey}
            day={day}
            reservations={reservations}
            now={now}
            canApply={canApply}
            selectedReservationId={selectedReservationId}
            onSelectSlot={onSelectSlot}
            onSelectReservation={onSelectReservation}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 左端の時刻の目盛り。
 *
 * 目盛りを線の高さに合わせるため、文字を上下の中央でずらしている。
 * ただし両端だけはずらさない。上端をずらすと見出しの裏に隠れ、
 * 下端をずらすと枠からはみ出して切れてしまう。
 *
 * 横スクロールしても左端に残す（sticky）。時刻が見えないまま横に送ると、
 * いま見ている帯が何時のものか分からなくなる。
 * sticky は位置の基準にもなるので、中の目盛りは相対位置のまま置ける。
 */
function HourAxis() {
  return (
    <div className="sticky left-0 z-10 bg-card">
      {axisHours.map((hour) => {
        const isFirst = hour === axisHours.at(0);
        const isLast = hour === axisHours.at(-1);

        return (
          <span
            key={hour}
            className="absolute right-2 text-[11px] tabular-nums text-muted-foreground"
            style={{
              top: `${toAxisPercent(hour * 60 - OPEN_MINUTES)}%`,
              transform: isFirst ? "none" : isLast ? "translateY(-100%)" : "translateY(-50%)",
            }}
          >
            {hour}:00
          </span>
        );
      })}
    </div>
  );
}

/** 1 日分の列。空き枠のボタンの上に、予約の帯を重ねて置く。 */
function DayColumn({
  day,
  reservations,
  now,
  canApply,
  selectedReservationId,
  onSelectSlot,
  onSelectReservation,
}: Readonly<{
  day: AvailabilityDay;
  reservations: readonly AvailabilityReservation[];
  now: Date;
  canApply: boolean;
  selectedReservationId: string | null;
  onSelectSlot: (day: AvailabilityDay, hour: number) => void;
  onSelectReservation: (reservation: AvailabilityReservation) => void;
}>) {
  const blocks = toDayBlocks(day, reservations);
  const placements = layoutTimelineItems(blocks);
  const occupiedHours = toOccupiedHours(blocks);
  const nowMinutes = tokyoMinutesOfDay(now);
  const showNowLine = day.isToday && nowMinutes >= OPEN_MINUTES && nowMinutes <= CLOSE_MINUTES;

  return (
    /*
     * 空き枠は等分に置く。高さを固定にせず、余った高さがあれば伸ばすことで、
     * 背の高い画面では 9〜21 時が縦スクロール無しで収まる。
     * 枠の数は利用可能時間（FACILITY_OPEN_HOUR〜FACILITY_CLOSE_HOUR）から決まるので、
     * ここに数を書かず slotHours から作る。
     */
    <div
      className={cn("relative grid border-l", day.isToday && "bg-primary/5")}
      style={{
        gridTemplateRows: `repeat(${slotHours.length}, minmax(0, 1fr))`,
        minHeight: `${GRID_MIN_HEIGHT_REM}rem`,
      }}
    >
      {slotHours.map((hour) => {
        /*
         * 承認済みの予約で埋まっている枠は押せなくする（COND-001）。
         * 帯を重ねて隠しているだけだと、帯の掛かっていない部分をクリックしたり
         * キーボードで送ったりして、埋まっている時間から申請を始められてしまう。
         */
        const isOccupied = occupiedHours.has(hour);

        return (
          <button
            key={hour}
            type="button"
            disabled={!canApply || isOccupied}
            onClick={() => onSelectSlot(day, hour)}
            aria-label={
              isOccupied
                ? `${formatMonthDay(day.date)} ${hour}:00 は予約済み`
                : `${formatMonthDay(day.date)} ${hour}:00 から予約を作成`
            }
            className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none"
          />
        );
      })}

      {showNowLine && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t-2 border-destructive/70"
          style={{ top: `${toAxisPercent(nowMinutes - OPEN_MINUTES)}%` }}
        />
      )}

      {placements.map(({ item, column, columnCount }) => (
        <ReservationBlock
          key={item.reservation.id}
          block={item}
          column={column}
          columnCount={columnCount}
          isSelected={item.reservation.id === selectedReservationId}
          onSelect={onSelectReservation}
        />
      ))}
    </div>
  );
}

/**
 * 予約 1 件分の帯。
 *
 * 同じ時間帯に重なった予約は横に分けて置く（{@link layoutTimelineItems}）。
 * 仮予約どうしは重なってよいため（COND-001）、単純に重ねると後ろが隠れてしまう。
 *
 * ボタンにしているのは、押して詳細を出すため。
 * 帯を押せなくすると、下に敷いてある空き枠のボタンが反応してしまい、
 * すでに予約が入っている時間帯で申請を始めてしまう。
 */
function ReservationBlock({
  block,
  column,
  columnCount,
  isSelected,
  onSelect,
}: Readonly<{
  block: AvailabilityBlock;
  column: number;
  columnCount: number;
  isSelected: boolean;
  onSelect: (reservation: AvailabilityReservation) => void;
}>) {
  const { reservation } = block;
  const style = blockStyle(reservation.status, reservation.isOwnGroup);
  const statusLabel = reservationStatusLabel[reservation.status];

  /*
   * 帯に出す時刻は、切り詰めた位置ではなく予約そのものの値を使う。
   * 9 時前から続いている予約を「9:00 開始」と書いてしまうと、
   * 実際の予約時間を読み違えることになる。
   * 日をまたぐ予約が「20:00〜10:00」と逆向きに見えないよう、
   * 表記は一覧（{@link AvailabilityWeekAgenda}）と同じ関数に任せる。
   */
  const timeRange = formatTimeRange(reservation.startAt, reservation.endAt);

  return (
    <button
      type="button"
      onClick={() => onSelect(reservation)}
      aria-pressed={isSelected}
      aria-label={`${timeRange} ${reservation.groupName} ${statusLabel} の詳細を見る`}
      className={cn(
        "absolute overflow-hidden rounded-md border px-1.5 py-1 text-left transition-shadow",
        "hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        style.box,
        // 選択中の帯は輪郭を強めて、どれの詳細を出しているかが分かるようにする
        isSelected && "ring-2 ring-ring ring-offset-1",
      )}
      style={{
        top: `${toAxisPercent(block.startMinutes - OPEN_MINUTES)}%`,
        height: `${toAxisPercent(block.endMinutes - block.startMinutes)}%`,
        left: `calc(${(column / columnCount) * 100}% + 2px)`,
        width: `calc(${100 / columnCount}% - 4px)`,
        minHeight: "1.5rem",
      }}
      title={`${timeRange}｜${reservation.groupName}｜${statusLabel}`}
    >
      {/* 左端の細い線。自団体の予約ほど濃くして、探しているものを見つけやすくする */}
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-0.5", style.rail)} />

      <p className="truncate text-[11px] leading-tight font-medium tabular-nums">{timeRange}</p>
      <p className="truncate text-[11px] leading-tight opacity-80">{reservation.groupName}</p>
    </button>
  );
}
