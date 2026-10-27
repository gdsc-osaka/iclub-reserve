import { cn } from "cn";
import { CalendarDays } from "lucide-react";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

import { AvailabilityCalendar } from "./availability-calendar";
import { CalendarToolbar } from "./calendar-toolbar";
import type { CalendarDraft, CalendarSelection } from "./paths";
import type { CalendarScroll } from "./use-calendar-scroll";

/**
 * 施設 1 件の空き状況カレンダー。この画面の本体にあたる。
 *
 * 上に見出しの帯（年月・前へ・今日・次へ）と凡例、その下に 4 週間ぶんのカレンダーを並べる。
 * 押した枠や予約は URL（`?draft=`・`?reservation=`）に置く（ADR-014 決定 8）。
 * 施設を切り替えても基準の日が同じなら、横の位置はそのまま残る。
 */
export function CalendarCard({
  facility,
  reservations,
  days,
  anchorKey,
  now,
  canPickSlot,
  scroll,
  selection,
  onOpenDraft,
  onOpenReservation,
  className,
}: Readonly<{
  facility: AvailabilityFacility;
  reservations: readonly AvailabilityReservation[];
  days: readonly AvailabilityDay[];
  /** 基準の日（URL の `date`） */
  anchorKey: string;
  /** ローダーが読んだ現在時刻。今日の列に「いま」の線を引くのに使う */
  now: Date;
  /** 空いている枠を押して申請または変更へ進めるかどうか（COND-006 / ADR-014 決定 15） */
  canPickSlot: boolean;
  scroll: CalendarScroll;
  /** 欄で開いているもの */
  selection: CalendarSelection | null;
  onOpenDraft: (draft: CalendarDraft) => void;
  onOpenReservation: (reservationId: string) => void;
  className?: string;
}>) {
  return (
    <Card className={cn("min-h-0 min-w-0 flex-1 gap-0 overflow-hidden py-0", className)}>
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-b py-4">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{facility.name}</span>
        </CardTitle>

        <CalendarToolbar
          visibleMonths={scroll.visibleMonths}
          anchorKey={anchorKey}
          onPrevious={scroll.goToPrevious}
          onNext={scroll.goToNext}
          onToday={scroll.goToToday}
          onSelectDate={scroll.goToDate}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        {/*
         * スマホで欄を開いている間は凡例を隠す。欄がカレンダーの下に入るぶん高さが足りず、
         * 凡例を出したままだと時刻の部分がほとんど見えなくなって、カレンダーで選び直せない。
         */}
        <Legend className={cn(selection !== null && "max-md:hidden")} />

        <div className="min-h-0 flex-1">
          <AvailabilityCalendar
            containerRef={scroll.containerRef}
            isReady={scroll.isReady}
            days={days}
            anchorKey={anchorKey}
            reservations={reservations}
            now={now}
            canPickSlot={canPickSlot}
            selection={selection}
            onOpenDraft={onOpenDraft}
            onOpenReservation={onOpenReservation}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 色と印の意味を説明する凡例。
 *
 * 色みでステータス、左端の線の太さで自団体かどうかを表しているので、
 * 説明が無いと「太い細いに意味があるのか」が分からない。
 */
function Legend({ className }: Readonly<{ className?: string }>) {
  return (
    <ul
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-sm border border-primary/40 bg-primary/20" />
        承認済み
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-3 rounded-sm border border-dashed border-amber-500/50 bg-amber-500/20"
        />
        仮予約
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-1 rounded-sm bg-primary" />
        左端の線が太いものが所属団体の予約
      </li>
      <li className="ml-auto hidden md:block">
        {`受付は ${FACILITY_OPEN_HOUR}:00〜${FACILITY_CLOSE_HOUR}:00 です。空いている時間を押すかなぞると申請できます。`}
      </li>
    </ul>
  );
}
