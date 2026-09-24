import { useRef } from "react";

import {
  axisHours,
  blockStyle,
  CLOSE_MINUTES,
  OPEN_MINUTES,
  toAxisPercent,
} from "~/components/reservation/availability-week";
import { reservationStatusLabel } from "~/components/reservation/reservation-status-badge";
import { layoutTimelineItems } from "~/components/reservation/timeline-layout";
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
  dragRange,
  startSlotMinutes,
  type SlotRange,
  type TimelineReservation,
} from "./reservation-slots";

/**
 * 30 分枠 1 つ分の高さ（rem）の既定値。
 *
 * 空き状況カレンダー（SCR-001）の 1 時間枠（2.75rem）より少し詰めている。
 * あちらは 7 日分を 1 画面に収める必要があるが、こちらは 1 日分だけなので、
 * 30 分枠でも予約の帯に時刻と団体名を 2 行で入れられる。
 */
const DEFAULT_SLOT_HEIGHT_REM = 1.5;

/**
 * 1 日分のタイムライン（SCR-002 の日時選択）。
 *
 * 空き状況カレンダー（SCR-001）と同じ縦軸・同じ配色にしてある。
 * 申請の直前に見る図が別物になると、カレンダーで見た空き具合と
 * フォームで見た空き具合が同じものだと気づけない。
 *
 * 枠を押して時間帯を選ぶが、フォームが実際に送るのは
 * 呼び出し側が持っている開始・終了の選択欄の値。
 * この図は「選択肢を絵で選べるようにしたもの」であって、入力そのものではない。
 */
export function ReservationTimeline({
  day,
  now,
  items,
  blockedSlots,
  pastSlots,
  range,
  disabled,
  slotHeightRem = DEFAULT_SLOT_HEIGHT_REM,
  onSelectSlot,
  onSelectRange,
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
  /**
   * 30 分枠 1 つ分の高さ（rem）。
   *
   * スマホの全画面の選択では、指で押しやすいように高くする。
   * 画面の高さを気にしなくてよい分、1 枠を指の幅に近づけられる。
   */
  slotHeightRem?: number;
  /** 枠を 1 つ押したとき。押した位置から、呼び出し側が時間帯を決め直す */
  onSelectSlot: (slotStartMinutes: number) => void;
  /** 枠をなぞって選んだとき。なぞっている間ずっと呼ばれる */
  onSelectRange: (range: SlotRange) => void;
}>) {
  const placements = layoutTimelineItems(items);
  /** タイムライン全体の高さ（rem）。利用可能時間と枠の刻みと、1 枠の高さだけで決まる */
  const timelineHeightRem = startSlotMinutes.length * slotHeightRem;
  const isToday = isSameTokyoDay(day, now);
  const nowMinutes = tokyoMinutesOfDay(now);

  /** なぞって伸ばすときに越えられない枠。埋まっている枠と、過ぎた枠 */
  const unselectableSlots = new Set([...blockedSlots, ...pastSlots]);

  /*
   * なぞっている最中の状態。`useState` にしないのは、指を動かすたびに
   * この図を描き直させないため。画面に出るのは呼び出し側が持つ `range` だけで、
   * ここが持つのは「どこから押し始めたか」という操作の途中経過にすぎない。
   */
  const gridRef = useRef<HTMLDivElement>(null);
  /** 押し始めた枠。なぞっていなければ null */
  const anchorRef = useRef<number | null>(null);
  /** 押し始めてから、別の枠まで動いたか */
  const movedRef = useRef(false);
  /** 直前の操作がなぞる操作だったか。なぞり終わりの click を捨てるために使う */
  const draggedRef = useRef(false);

  /**
   * 画面の縦位置から、そこにある枠を割り出す。
   *
   * どの要素の上にいるかを調べず、枠の並び全体の高さから計算しているのは、
   * なぞっている間ポインタを押し始めた枠に固定している（`setPointerCapture`）ため。
   * 固定しないと、埋まっている枠（`disabled`）の上を通った瞬間に
   * 指を追うのをやめてしまう。
   */
  const slotAt = (clientY: number): number | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.height === 0) return null;

    const index = Math.floor(((clientY - rect.top) / rect.height) * startSlotMinutes.length);

    return startSlotMinutes[Math.min(startSlotMinutes.length - 1, Math.max(0, index))] ?? null;
  };

  const endDrag = () => {
    draggedRef.current = movedRef.current;
    anchorRef.current = null;
    movedRef.current = false;
  };

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)]">
      <div className="relative" style={{ height: `${timelineHeightRem}rem` }}>
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
        style={{ height: `${timelineHeightRem}rem` }}
      >
        <div
          ref={gridRef}
          className="grid h-full select-none"
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
                /*
                 * なぞるのはマウス・ペンだけにしている。指でも取れるようにするには
                 * この図の `touch-action` を切る必要があり、そうすると
                 * スマホでこの図の上から始めた縦スクロールが効かなくなる。
                 * 指では、枠を押してから後ろの枠を押す、で同じことができる。
                 */
                onPointerDown={(event) => {
                  if (event.pointerType === "touch" || event.button !== 0) return;

                  event.currentTarget.setPointerCapture(event.pointerId);
                  anchorRef.current = slot;
                  movedRef.current = false;
                  // 前の操作の取りこぼしを持ち越さない（click が来ずに終わった場合）
                  draggedRef.current = false;
                }}
                onPointerMove={(event) => {
                  const anchor = anchorRef.current;
                  if (anchor === null) return;

                  const hovered = slotAt(event.clientY);
                  if (hovered === null) return;
                  // 押しただけ（1 枠も動いていない）なら、click の扱いに任せる
                  if (!movedRef.current && hovered === anchor) return;

                  movedRef.current = true;
                  onSelectRange(dragRange(anchor, hovered, unselectableSlots));
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={() => {
                  // なぞり終わりにも click は来る。ここで選び直すと、なぞった結果が消える
                  if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                  }

                  onSelectSlot(slot);
                }}
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
            data-slot="timeline-now"
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
            data-slot="timeline-selection"
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
 * 「押すと選べる」「後ろの枠を押すと伸びる」は見ただけでは分からないので、
 * 凡例と同じ場所に書いている。
 *
 * 伸ばし方は、指でもマウスでもできる「後ろの枠を押す」を先に書く。
 * なぞる操作はマウス・ペンだけで、スマホでは効かない（縦スクロールを優先している）。
 * スマホの全画面の選択にも同じ説明が出るので、なぞれば伸びると読める書き方にしない。
 */
export function ReservationTimelineLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-sm border-2 border-primary bg-primary/15" />
        選択中の時間帯
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
        枠を押すと {RESERVATION_STEP_MINUTES}{" "}
        分選べます。続けて後ろの枠を押すと、その枠まで伸びます。マウスなら、なぞって選ぶこともできます。
      </li>
    </ul>
  );
}
