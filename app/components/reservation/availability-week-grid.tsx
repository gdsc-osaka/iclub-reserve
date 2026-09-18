import { formatMonthDay, formatTimeRange, tokyoMinutesOfDay } from "~/lib/date";
import { cn } from "~/lib/utils";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

import { AvailabilityDraftCard, AvailabilityReservationCard } from "./availability-detail-card";
import {
  axisHours,
  blockContent,
  blockStyle,
  CLOSE_MINUTES,
  GRID_MIN_HEIGHT_REM,
  OPEN_MINUTES,
  slotHours,
  toAxisPercent,
  toDayBlocks,
  toOccupiedHours,
  weekdayStyle,
  type AvailabilityBlock,
  type AvailabilityDay,
} from "./availability-week";
import { reservationStatusLabel } from "./reservation-status-badge";
import { layoutTimelineItems } from "./timeline-layout";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

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
 * 団体名を折り返す行数ごとの class。
 *
 * `line-clamp-${lines}` と組み立てないこと。Tailwind はソースに書かれた文字列を
 * そのまま探して CSS を作るので、組み立てた class 名は見つけてもらえない。
 */
const nameClampClass: Readonly<Record<number, string>> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

/**
 * 1 週間 × 施設 1 件のタイムライン（横長の画面向け）。
 *
 * 縦を時間、横を日付にしているのは、「この施設は今週いつ空いているか」を
 * 1 画面で見比べられるようにするため。
 *
 * 帯には入るぶんの情報しか書けないので、押すと吹き出しで残りを出す。
 * 吹き出しにしているのは、カレンダーの上下に差し込むと押すたびに表が動いて、
 * 次に狙っていた枠が逃げてしまうため。
 *
 * スマホでは同じ内容を {@link AvailabilityWeekAgenda} が縦に並べて出す。
 * どちらを出すかは CSS の画面幅だけで決めていて、JavaScript では判定していない。
 */
export function AvailabilityWeekGrid({
  days,
  reservations,
  facility,
  now,
  canApply,
  isStaff,
}: Readonly<{
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  /** いま見ている施設・設備。空き枠から申請へ持っていく初期値に使う */
  facility: AvailabilityFacility;
  /** ローダーが読んだ現在時刻。今日の列に「いま」の線を引くのに使う */
  now: Date;
  /** 空き枠を押して申請へ進めるかどうか（COND-006） */
  canApply: boolean;
  /** 事務局かどうか。申請ボタンの文言を変えるのに使う */
  isStaff: boolean;
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
      {/*
       * 最低幅を 52rem にしているのは、帯が横に 2 つ並んだときに
       * 団体名が 1 行 2 文字まで潰れないようにするため。
       * これより狭い画面では横にスクロールさせる。
       */}
      <div className="grid min-h-full min-w-[52rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] grid-rows-[auto_1fr]">
        {/*
         * 左上の角。縦にも横にも動かさないので、日付の行と時刻の列の
         * どちらが下を通っても隠れないよう、いちばん手前に置く。
         */}
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />

        {days.map((day) => (
          <DayHeading key={day.dateKey} day={day} />
        ))}

        <HourAxis />

        {days.map((day) => (
          <DayColumn
            key={day.dateKey}
            day={day}
            reservations={reservations}
            facility={facility}
            now={now}
            canApply={canApply}
            isStaff={isStaff}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 日付の見出し 1 日分。
 *
 * 縦スクロールでも残す。下を予約の帯が通るので、
 * 透けない背景（bg-card）を敷いておく。色付けは重ねた内側の箱で行う。
 * 背景色を 1 つの箱で兼ねようとすると、半透明の色の下を帯が透けて見えてしまう。
 *
 * 今日は色を塗りつぶして白抜きにする。以前は薄い色の上に同系色の文字を
 * 重ねていたが、緑の上の緑で読みにくかった。
 * 今日と週末が重なる日は今日を優先する。週末かどうかは並びの位置で分かるが、
 * 今日がどこかは色でしか分からないため。
 *
 * 見出しの面の色は、下に続く列（{@link DayColumn}）と同じものを敷く。
 * 見出しと列で塗り方が違うと、同じ日の上下が別のものに見えてしまう。
 */
function DayHeading({ day }: Readonly<{ day: AvailabilityDay }>) {
  const weekday = weekdayStyle(day.weekday);

  return (
    <div className="sticky top-0 z-20 border-b border-l bg-card">
      <div
        className={cn(
          "h-full py-2 text-center",
          day.isToday ? "bg-primary font-medium text-primary-foreground" : weekday.surface,
        )}
      >
        {/*
         * 色を付けるのは曜日だけ。日付の数字まで赤や青にすると、
         * その日付が誤っているように見えてしまう。
         * 今日は見出しごと白抜きなので、ここでは色を足さず受け継ぐ。
         */}
        <p className={cn("text-xs", !day.isToday && (weekday.label ?? "text-muted-foreground"))}>
          {weekdayFormatter.format(day.date)}
        </p>
        <p className="text-sm">{shortDateFormatter.format(day.date)}</p>
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
  facility,
  now,
  canApply,
  isStaff,
}: Readonly<{
  day: AvailabilityDay;
  reservations: readonly AvailabilityReservation[];
  facility: AvailabilityFacility;
  now: Date;
  canApply: boolean;
  isStaff: boolean;
}>) {
  const blocks = toDayBlocks(day, reservations);
  const placements = layoutTimelineItems(blocks);
  const occupiedHours = toOccupiedHours(blocks);
  const nowMinutes = tokyoMinutesOfDay(now);
  const showNowLine = day.isToday && nowMinutes >= OPEN_MINUTES && nowMinutes <= CLOSE_MINUTES;
  const weekday = weekdayStyle(day.weekday);

  return (
    /*
     * 空き枠は等分に置く。高さを固定にせず、余った高さがあれば伸ばすことで、
     * 背の高い画面では 9〜21 時が縦スクロール無しで収まる。
     * 枠の数は利用可能時間（FACILITY_OPEN_HOUR〜FACILITY_CLOSE_HOUR）から決まるので、
     * ここに数を書かず slotHours から作る。
     */
    <div
      className={cn("relative grid border-l", day.isToday ? "bg-primary/10" : weekday.surface)}
      style={{
        gridTemplateRows: `repeat(${slotHours.length}, minmax(0, 1fr))`,
        minHeight: `${GRID_MIN_HEIGHT_REM}rem`,
      }}
    >
      {slotHours.map((hour) => (
        <AvailableSlot
          key={hour}
          day={day}
          hour={hour}
          facility={facility}
          /*
           * 承認済みの予約で埋まっている枠は押せなくする（COND-001）。
           * 帯を重ねて隠しているだけだと、帯の掛かっていない部分をクリックしたり
           * キーボードで送ったりして、埋まっている時間から申請を始められてしまう。
           */
          isOccupied={occupiedHours.has(hour)}
          canApply={canApply}
          isStaff={isStaff}
        />
      ))}

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
        />
      ))}
    </div>
  );
}

/**
 * 空いている 1 時間の枠。押すと、その日時で申請に進む吹き出しが出る。
 *
 * 押せないときは吹き出しごと付けない。開く手立てが無いのに
 * 吹き出しを用意しても、開くことはないため。
 */
function AvailableSlot({
  day,
  hour,
  facility,
  isOccupied,
  canApply,
  isStaff,
}: Readonly<{
  day: AvailabilityDay;
  hour: number;
  facility: AvailabilityFacility;
  isOccupied: boolean;
  canApply: boolean;
  isStaff: boolean;
}>) {
  const label = isOccupied
    ? `${formatMonthDay(day.date)} ${hour}:00 は予約済み`
    : `${formatMonthDay(day.date)} ${hour}:00 から予約を作成`;

  const className =
    "border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none";

  if (!canApply || isOccupied) {
    return <button type="button" disabled aria-label={label} className={className} />;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={className} />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72">
        <AvailabilityDraftCard draft={{ facility, day, startHour: hour }} isStaff={isStaff} />
      </PopoverContent>
    </Popover>
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
 *
 * 中身は上から詰める。縦の中央に置くと、長い帯では上下に余白が散って
 * 書ける行数が減るうえ、隣の帯と行の高さがそろわない。
 */
function ReservationBlock({
  block,
  column,
  columnCount,
}: Readonly<{
  block: AvailabilityBlock;
  column: number;
  columnCount: number;
}>) {
  const { reservation } = block;
  const style = blockStyle(reservation.status, reservation.isOwnGroup);
  const statusLabel = reservationStatusLabel[reservation.status];
  const content = blockContent(block.endMinutes - block.startMinutes, columnCount);

  /*
   * 帯に出す時刻は、切り詰めた位置ではなく予約そのものの値を使う。
   * 9 時前から続いている予約を「9:00 開始」と書いてしまうと、
   * 実際の予約時間を読み違えることになる。
   * 日をまたぐ予約が「20:00〜10:00」と逆向きに見えないよう、
   * 表記は一覧（{@link AvailabilityWeekAgenda}）と同じ関数に任せる。
   */
  const timeRange = formatTimeRange(reservation.startAt, reservation.endAt);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${timeRange} ${reservation.groupName} ${statusLabel} の詳細を見る`}
          className={cn(
            "absolute flex flex-col overflow-hidden rounded-md border py-1 pr-1.5 text-left transition-shadow gap-0.5",
            // 自団体は左端の線が太いぶん、文字の始まりも右へずらす
            reservation.isOwnGroup ? "pl-2.5" : "pl-2",
            "hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            style.box,
            // 吹き出しを開いている帯は輪郭を強めて、どれの詳細を出しているかが分かるようにする
            "data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:ring-offset-1",
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
          {/* 左端の線。自団体の予約ほど太くして、探しているものを見つけやすくする */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0",
              reservation.isOwnGroup ? "w-1" : "w-0.5",
              style.rail,
            )}
          />

          {content.showTime && (
            <p className="truncate text-[11px] leading-tight font-medium tabular-nums">
              {timeRange}
            </p>
          )}

          <p
            className={cn(
              "text-[11px] leading-tight wrap-anywhere",
              nameClampClass[content.nameLines],
              reservation.isOwnGroup && "font-medium",
            )}
          >
            {reservation.groupName}
          </p>

          {content.showStatus && (
            <p className="truncate text-[11px] leading-tight">
              {statusLabel}
              {reservation.isOwnGroup && "・自団体"}
            </p>
          )}

          {content.showHeadCount && reservation.detail !== null && (
            <p className="truncate text-[11px] leading-tight">{reservation.detail.headCount} 名</p>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72">
        <AvailabilityReservationCard reservation={reservation} />
      </PopoverContent>
    </Popover>
  );
}
