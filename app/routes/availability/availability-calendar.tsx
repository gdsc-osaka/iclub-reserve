import { cn } from "cn";
import type { RefObject } from "react";

import {
  axisHours,
  blockContent,
  blockStyle,
  CLOSE_MINUTES,
  DAYS_IN_WEEK,
  GRID_MIN_HEIGHT_REM,
  OPEN_MINUTES,
  toAxisPercent,
  toDayBlocks,
  weekdayLabel,
  weekdayStyle,
  type AvailabilityBlock,
  type AvailabilityDay,
} from "~/components/reservation/availability-week";
import {
  startSlotMinutes,
  toBlockedSlots,
  toDefaultRange,
  toPastSlots,
  type RangeEdge,
  type SlotRange,
} from "~/components/reservation/editor/reservation-slots";
import { reservationStatusLabel } from "~/components/reservation/reservation-status-badge";
import { layoutTimelineItems } from "~/components/reservation/timeline-layout";
import { formatMonthDay, formatTimeRange, tokyoMinutesOfDay, toTokyoTimeKey } from "~/lib/date";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { findDayIndex } from "./calendar-window";
import type { CalendarDraft, CalendarSelection } from "./paths";
import { useDraftGesture, type DraftGesture, type GestureDraft } from "./use-draft-gesture";

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
 * 予約の帯の右に残す余白。ここの 30 分の枠は帯に隠れないので、
 * 仮予約の上からでも申請を始められる（ADR-014 決定 6）。
 */
const BLOCK_GUTTER = "0.75rem";

/**
 * 空き状況カレンダーの本体（ADR-014 決定 2・3・5・6）。
 *
 * 縦を時間、横を日付にしているのは、「この施設はいつ空いているか」を
 * 1 画面で見比べられるようにするため。
 *
 * 28 日ぶんの日の列を横に 1 本並べ、並べる日数（7・5・3）は箱の幅で CSS が決める。
 * JavaScript で幅を測って描き分けると、表示されたあとに切り替わってちらつく。
 */
export function AvailabilityCalendar({
  containerRef,
  isReady,
  days,
  anchorKey,
  reservations,
  now,
  canApply,
  selection,
  onOpenDraft,
  onOpenReservation,
}: Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  /** 横の位置を合わせ終えたか。それまでは基準より前の列を隠す */
  isReady: boolean;
  days: readonly AvailabilityDay[];
  /** 基準の日（URL の `date`） */
  anchorKey: string;
  reservations: readonly AvailabilityReservation[];
  /** ローダーが読んだ現在時刻。今日の列に「いま」の線を引くのに使う */
  now: Date;
  /** 空いている枠を押して申請へ進めるかどうか（COND-006） */
  canApply: boolean;
  /** 開いているもの。予約の帯の輪郭と仮の枠に使う */
  selection: CalendarSelection | null;
  onOpenDraft: (draft: CalendarDraft) => void;
  onOpenReservation: (reservationId: string) => void;
}>) {
  const anchorIndex = findDayIndex(days, anchorKey);
  const gesture = useDraftGesture({ onOpenDraft });

  return (
    /*
     * スクロールするのはこの箱 1 つだけ（縦も横も）。ページ全体は動かさない。
     * どちらの向きに送っても、日付の見出しと時刻の軸は端に貼り付いたまま残る（sticky）。
     *
     * `@container` はこの箱そのものに付ける。`cqw` が縦のスクロールバーを除いた幅を指すので、
     * 外のカードに付けると、Windows のスクロールバーのぶん列がはみ出して止まる位置がずれる。
     *
     * ScrollArea を使わないのは、scroll-snap・`@container`・`scrollTo` を
     * 実際にスクロールする要素に付ける必要があるのに、ScrollArea は中の要素に class も ref も渡せないため。
     *
     * `scroll-pt-14` は日付の見出し（sticky）の高さ。キーボードの移動などで帯を見える所へ送るとき、
     * 見出しの裏に隠さないようにする。
     */
    <div
      ref={containerRef}
      data-ready={isReady}
      className="group/calendar @container h-full snap-x snap-mandatory scroll-pl-14 scroll-pt-14 overflow-auto overscroll-contain"
    >
      <div className="flex min-h-full w-max">
        <HourAxis />

        {days.map((day, index) => (
          <DayColumn
            key={day.dateKey}
            day={day}
            hiddenUntilReady={toHiddenUntilReady(index, anchorIndex)}
            reservations={reservations}
            now={now}
            canApply={canApply}
            selection={selection}
            gesture={gesture}
            onOpenDraft={onOpenDraft}
            onOpenReservation={onOpenReservation}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 横の位置を合わせ終えるまで隠す列の class（ADR-014 決定 5）。
 *
 * サーバーで描く時点では横の位置を決められないので、基準より前の列を隠しておけば、
 * スクロールの位置が 0 のままでも基準の日（7 日の表示ではその週の日曜）が左端に来る。
 * - 0〜6 番目（基準の週の前の週）: どの表示日数でも隠す
 * - 基準の週の日曜から基準の日の手前: 7 日の表示では出し、5・3 日の表示では隠す
 */
const toHiddenUntilReady = (index: number, anchorIndex: number): string | null => {
  if (index < DAYS_IN_WEEK) return "group-data-[ready=false]/calendar:hidden";
  if (index < anchorIndex) {
    return "group-data-[ready=false]/calendar:hidden @min-[52rem]:group-data-[ready=false]/calendar:flex";
  }
  return null;
};

/**
 * この日の列に描く仮の枠の時間帯。描かないなら null（時刻を選んでいない仮の枠も描かない）。
 *
 * なぞる操作・丸を動かす操作の途中は、URL の仮の枠の代わりに途中の時間帯を描く（ADR-014 決定 12）。
 * 仮の枠が 2 つ見えないよう、操作中は操作している日にだけ描く。
 */
const toShownDraftRange = (
  gestureDraft: GestureDraft | null,
  selection: CalendarSelection | null,
  dateKey: string,
): SlotRange | null => {
  if (gestureDraft !== null) return gestureDraft.dateKey === dateKey ? gestureDraft.range : null;
  if (selection?.kind !== "draft" || selection.draft.dateKey !== dateKey) return null;
  return selection.draft.range;
};

/**
 * 左端の時刻の軸。
 *
 * 横スクロールしても左端に残す（sticky）。時刻が見えないまま横に送ると、
 * いま見ている帯が何時のものか分からなくなる。
 */
function HourAxis() {
  return (
    <div data-slot="hour-axis" className="sticky left-0 z-20 flex w-14 shrink-0 flex-col bg-card">
      {/*
       * 左上の角。縦にも横にも動かさないので、日付の見出しと時刻の軸の
       * どちらが下を通っても隠れないよう、いちばん手前に置く。
       */}
      <div className="sticky top-0 z-30 h-14 shrink-0 border-b bg-card" />

      {/*
       * 目盛りを線の高さに合わせるため、文字を上下の中央でずらしている。
       * ただし両端だけはずらさない。上端をずらすと見出しの裏に隠れ、
       * 下端をずらすと枠からはみ出して切れてしまう。
       */}
      <div className="relative flex-1" style={{ minHeight: `${GRID_MIN_HEIGHT_REM}rem` }}>
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
    </div>
  );
}

/**
 * 1 日分の列。見出しと本体を縦に重ねた 1 つの要素にしている。
 *
 * 日ごとにまとめておくと、整うまで隠す処理（{@link toHiddenUntilReady}）が 1 つの要素で済む。
 * `role="group"` と日付の名前は、読み上げとテストで日を探すのに使う。
 */
function DayColumn({
  day,
  hiddenUntilReady,
  reservations,
  now,
  canApply,
  selection,
  gesture,
  onOpenDraft,
  onOpenReservation,
}: Readonly<{
  day: AvailabilityDay;
  hiddenUntilReady: string | null;
  reservations: readonly AvailabilityReservation[];
  now: Date;
  canApply: boolean;
  selection: CalendarSelection | null;
  gesture: DraftGesture;
  onOpenDraft: (draft: CalendarDraft) => void;
  onOpenReservation: (reservationId: string) => void;
}>) {
  const blocks = toDayBlocks(day, reservations);
  const placements = layoutTimelineItems(blocks);
  /*
   * 承認済みの予約と重なる枠は押せなくする（COND-001）。
   * 帯を重ねて隠しているだけだと、帯の掛かっていない余白を押して、
   * 埋まっている時間から申請を始められてしまう。
   */
  const blockedSlots = toBlockedSlots(blocks);
  // 過ぎた時刻からは申請できない。今日の現在時刻より前と、過ぎた日の枠がここに入る
  const pastSlots = toPastSlots(day.date, now);
  // なぞる操作・丸を動かす操作で選べない枠（承認済み予約・過ぎた枠）
  const unselectableSlots = new Set([...blockedSlots, ...pastSlots]);
  const nowMinutes = tokyoMinutesOfDay(now);
  const showNowLine = day.isToday && nowMinutes >= OPEN_MINUTES && nowMinutes <= CLOSE_MINUTES;
  const weekday = weekdayStyle(day);
  const draftRange = toShownDraftRange(gesture.gestureDraft, selection, day.dateKey);

  return (
    <div
      data-slot="day-column"
      data-date-key={day.dateKey}
      role="group"
      aria-label={formatMonthDay(day.date)}
      className={cn(
        "flex w-[calc((100cqw-3.5rem)/3)] shrink-0 flex-col @min-[36rem]:w-[calc((100cqw-3.5rem)/5)] @min-[52rem]:w-[calc((100cqw-3.5rem)/7)]",
        /*
         * 7 日の表示では日曜だけで止まり、5・3 日の表示では毎日止まる（ADR-014 決定 3）。
         * 同じ要素に snap-start と snap-align-none を条件違いで付けて打ち消し合わせず、
         * 日曜かどうかで付ける class を分ける。
         */
        day.weekday === 0
          ? "snap-start snap-always"
          : "snap-start snap-always @min-[52rem]:snap-align-none",
        hiddenUntilReady,
      )}
    >
      <DayHeading day={day} />

      {/*
       * 空いている枠は等分に置く。高さを固定にせず、余った高さがあれば伸ばすことで、
       * 背の高い画面では 9〜21 時が縦スクロール無しで収まる。
       *
       * `isolate` で重なりの順番をこの中に閉じ込める。閉じ込めないと、現在時刻の線や仮の枠が
       * 縦に送ったときに日付の見出しの上へはみ出す。
       */}
      <div
        data-slot="day-body"
        className={cn(
          "relative isolate grid flex-1 border-l select-none",
          day.isToday ? "bg-primary/10" : weekday.surface,
        )}
        style={{
          gridTemplateRows: `repeat(${startSlotMinutes.length}, minmax(0, 1fr))`,
          minHeight: `${GRID_MIN_HEIGHT_REM}rem`,
        }}
      >
        {startSlotMinutes.map((slotMinutes) => (
          <SlotButton
            key={slotMinutes}
            day={day}
            slotMinutes={slotMinutes}
            isOccupied={blockedSlots.has(slotMinutes)}
            isPast={pastSlots.has(slotMinutes)}
            canApply={canApply}
            onPointerDown={(event) =>
              gesture.onSlotPointerDown(event, day.dateKey, slotMinutes, unselectableSlots)
            }
            onPointerMove={gesture.onPointerMove}
            onPointerUp={gesture.onPointerUp}
            onPointerCancel={gesture.onPointerCancel}
            onClick={() =>
              gesture.onSlotClick(() => {
                onOpenDraft({
                  dateKey: day.dateKey,
                  range: toDefaultRange(slotMinutes, blockedSlots),
                });
              })
            }
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
            isOpen={
              selection?.kind === "reservation" && selection.reservationId === item.reservation.id
            }
            onSelect={() => onOpenReservation(item.reservation.id)}
          />
        ))}

        {draftRange !== null && (
          <DraftBlock
            range={draftRange}
            onHandlePointerDown={(event, edge) =>
              gesture.onHandlePointerDown(event, day.dateKey, draftRange, edge, unselectableSlots)
            }
            onHandlePointerMove={gesture.onPointerMove}
            onHandlePointerUp={gesture.onPointerUp}
            onHandlePointerCancel={gesture.onPointerCancel}
          />
        )}
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
 * 高さは左上の角と同じ固定の高さ（h-14）にする。
 *
 * 今日は色を塗りつぶして白抜きにする。以前は薄い色の上に同系色の文字を
 * 重ねていたが、緑の上の緑で読みにくかった。
 * 今日と週末が重なる日は今日を優先する。週末かどうかは並びの位置で分かるが、
 * 今日がどこかは色でしか分からないため。
 *
 * 見出しの面の色は、下に続く本体と同じものを敷く。
 * 見出しと本体で塗り方が違うと、同じ日の上下が別のものに見えてしまう。
 */
function DayHeading({ day }: Readonly<{ day: AvailabilityDay }>) {
  const weekday = weekdayStyle(day);

  return (
    <div
      data-slot="day-heading"
      className="sticky top-0 z-10 h-14 shrink-0 border-b border-l bg-card"
    >
      <div
        className={cn(
          "flex h-full flex-col justify-center text-center",
          day.isToday ? "bg-primary font-medium text-primary-foreground" : weekday.surface,
        )}
      >
        {/*
         * 色を付けるのは曜日だけ。日付の数字まで赤や青にすると、
         * その日付が誤っているように見えてしまう。
         * 今日は見出しごと白抜きなので、ここでは色を足さず受け継ぐ。
         */}
        <p
          className={cn(
            "text-xs whitespace-nowrap",
            !day.isToday && (weekday.label ?? "text-muted-foreground"),
          )}
        >
          {weekdayLabel(day)}
        </p>
        <p className="text-sm whitespace-nowrap">{shortDateFormatter.format(day.date)}</p>
      </div>
    </div>
  );
}

/**
 * 30 分の枠。押すと、その時刻からの仮の枠を開く。
 *
 * 素の `<button>` にしている。`Button` の高さ・余白・角の丸み・押したときに 1px 下がる動き
 * （`active:translate-y-px`）が、カレンダーの中で位置と高さを決めて置くのに邪魔になる。
 *
 * `tabIndex={-1}` で Tab の巡回から外す。4 週間で 672 個あり、Tab で巡らせると
 * 欄やほかのボタンへたどり着けなくなる。
 */
function SlotButton({
  day,
  slotMinutes,
  isOccupied,
  isPast,
  canApply,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
}: Readonly<{
  day: AvailabilityDay;
  slotMinutes: number;
  isOccupied: boolean;
  isPast: boolean;
  canApply: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}>) {
  const at = `${formatMonthDay(day.date)} ${toTokyoTimeKey(slotMinutes)}`;
  const label = isOccupied
    ? `${at} は予約済み`
    : isPast
      ? `${at} は過ぎています`
      : `${at} から申請`;

  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={!canApply || isOccupied || isPast}
      aria-label={label}
      className={cn(
        "transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none",
        // 毎時 0 分の枠の下は 30 分の区切りなので、1 時間の区切りより薄くする
        slotMinutes % 60 === 0
          ? "border-b border-dashed border-border/40"
          : "border-b border-border/60 last:border-b-0",
        /*
         * 過ぎた枠は面を落とす。押せないことを読み上げ名だけで伝えると、
         * 目で見ている人には空いている枠と同じに見えてしまう。
         * 現在時刻の線は今日の列にしか引かれないので、過ぎた日はこの色だけが手がかりになる。
         */
        isPast && "bg-muted/40",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
    />
  );
}

/**
 * 予約 1 件分の帯。
 *
 * 同じ時間帯に重なった予約は横に分けて置く（{@link layoutTimelineItems}）。
 * 仮予約どうしは重なってよいため（COND-001）、単純に重ねると後ろが隠れてしまう。
 * 帯は列の右に余白（{@link BLOCK_GUTTER}）を残し、横に並ぶ帯は余白を除いた幅を分け合う。
 *
 * 素の `<button>` にしているのは、30 分の枠と同じく位置と高さを決めて置くため。
 * 押すと欄に内容を出す。
 *
 * 中身は上から詰める。縦の中央に置くと、長い帯では上下に余白が散って
 * 書ける行数が減るうえ、隣の帯と行の高さがそろわない。
 */
function ReservationBlock({
  block,
  column,
  columnCount,
  isOpen,
  onSelect,
}: Readonly<{
  block: AvailabilityBlock;
  column: number;
  columnCount: number;
  /** 欄に開いている予約か */
  isOpen: boolean;
  onSelect: () => void;
}>) {
  const { reservation } = block;
  const style = blockStyle(reservation.status, reservation.isOwnGroup);
  const statusLabel = reservationStatusLabel[reservation.status];
  const content = blockContent(block.endMinutes - block.startMinutes, columnCount);

  /*
   * 帯に出す時刻は、切り詰めた位置ではなく予約そのものの値を使う。
   * 9 時前から続いている予約を「9:00 開始」と書いてしまうと、
   * 実際の予約時間を読み違えることになる。
   * 日をまたぐ予約が「20:00〜10:00」と逆向きに見えないよう、表記は formatTimeRange に任せる。
   */
  const timeRange = formatTimeRange(reservation.startAt, reservation.endAt);

  return (
    <button
      type="button"
      aria-label={`${timeRange} ${reservation.groupName} ${statusLabel} の詳細を見る`}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-md border py-1 pr-1.5 text-left transition-shadow gap-0.5",
        // 自団体は左端の線が太いぶん、文字の始まりも右へずらす
        reservation.isOwnGroup ? "pl-2.5" : "pl-2",
        "hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        style.box,
        // 欄に開いている帯は輪郭を強めて、どれの内容を出しているかが分かるようにする
        isOpen && "ring-2 ring-ring ring-offset-1",
      )}
      style={{
        top: `${toAxisPercent(block.startMinutes - OPEN_MINUTES)}%`,
        height: `${toAxisPercent(block.endMinutes - block.startMinutes)}%`,
        left: `calc((100% - ${BLOCK_GUTTER}) * ${column / columnCount} + 2px)`,
        width: `calc((100% - ${BLOCK_GUTTER}) / ${columnCount} - 4px)`,
        minHeight: "1.5rem",
      }}
      title={`${timeRange}｜${reservation.groupName}｜${statusLabel}`}
      onClick={onSelect}
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
        <p className="truncate text-[11px] leading-tight font-medium tabular-nums">{timeRange}</p>
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
          {reservation.isOwnGroup && "・所属団体"}
        </p>
      )}

      {content.showHeadCount && reservation.detail !== null && (
        <p className="truncate text-[11px] leading-tight">{reservation.detail.headCount} 名</p>
      )}
    </button>
  );
}

/**
 * 仮の枠。これから申請する時間帯を、予約の帯より手前に描く。
 *
 * 枠そのものは押せなくしている（pointer-events-none）。下の 30 分の枠を押して選び直せるようにするため。
 * 上端（開始）と下端（終了）の丸だけ押せるようにし、上下に動かして時間帯を伸び縮みさせられる（ADR-014 決定 12）。
 * 中身は欄の見出しと時間帯で、読み上げでは欄を読めば足りるので全体を隠す（aria-hidden）。
 */
function DraftBlock({
  range,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
}: Readonly<{
  range: SlotRange;
  onHandlePointerDown: (event: React.PointerEvent, edge: RangeEdge) => void;
  onHandlePointerMove: (event: React.PointerEvent) => void;
  onHandlePointerUp: () => void;
  onHandlePointerCancel: () => void;
}>) {
  const handleProps = {
    onPointerMove: onHandlePointerMove,
    onPointerUp: onHandlePointerUp,
    onPointerCancel: onHandlePointerCancel,
  };

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col rounded-md border-2 border-primary bg-primary/15 px-1.5 py-1 text-[11px] leading-tight"
      style={{
        top: `${toAxisPercent(range.startMinutes - OPEN_MINUTES)}%`,
        height: `${toAxisPercent(range.endMinutes - range.startMinutes)}%`,
      }}
    >
      <span className="font-medium">新しい予約</span>
      <span className="tabular-nums">
        {toTokyoTimeKey(range.startMinutes)}〜{toTokyoTimeKey(range.endMinutes)}
      </span>

      <DraftHandle
        edge="start"
        onPointerDown={(event) => onHandlePointerDown(event, "start")}
        {...handleProps}
      />
      <DraftHandle
        edge="end"
        onPointerDown={(event) => onHandlePointerDown(event, "end")}
        {...handleProps}
      />
    </div>
  );
}

/**
 * 仮の枠の端の丸。上下に動かして時間帯を伸び縮みさせる（ADR-014 決定 12）。
 *
 * Google カレンダーに合わせて、開始の丸は上端の左寄り、終了の丸は下端の右寄りに置き、枠の線の上に中心を合わせる。
 * 見た目は小さな丸（size-3）だが、指でも押せるよう透明な外側の箱（size-8）で押せる範囲を広げている。
 *
 * `touch-none` を付けるのは、丸の上で指を動かしたときに、カレンダーが縦にスクロールせず丸が動くようにするため。
 * 30 分の枠には付けない。指でなぞる操作は無く、枠の上ではスクロールに使う。
 *
 * 読み上げでは仮の枠ごと隠れる。E2E で探せるよう data-slot を付ける。
 */
function DraftHandle({
  edge,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: Readonly<{
  edge: RangeEdge;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}>) {
  return (
    <div
      data-slot={edge === "start" ? "draft-start-handle" : "draft-end-handle"}
      className={cn(
        "pointer-events-auto absolute flex size-8 cursor-ns-resize touch-none items-center justify-center",
        edge === "start" ? "-top-4 left-2" : "-bottom-4 right-2",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="size-3 rounded-full border-2 border-primary bg-card shadow-xs" />
    </div>
  );
}
