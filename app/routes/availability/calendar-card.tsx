import { CalendarDays, Plus } from "lucide-react";

import { AvailabilityDraftCard } from "~/components/reservation/availability-detail-card";
import { buildWeekDays } from "~/components/reservation/availability-week";
import { AvailabilityWeekAgenda } from "~/components/reservation/availability-week-agenda";
import { AvailabilityWeekGrid } from "~/components/reservation/availability-week-grid";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

import { WeekNavigation } from "./week-navigation";

/**
 * 施設 1 件の 1 週間ぶんのカレンダー。この画面の本体にあたる。
 *
 * 押したものの中身は、押した場所に重なる吹き出し（Popover）で出す。
 * どれを開いているかは吹き出しが自分で覚えるので、この画面では持たない。
 *
 * 以前はカレンダーの上に欄を差し込んでいたが、押すたびに表が上下に動いて、
 * 次に狙っていた枠が逃げてしまっていた。
 *
 * 施設や週を切り替えると、帯も空き枠も作り直されるので吹き出しは閉じる。
 * 別の施設・別の日の内容が残ったままになることはない（COND-008）。
 */
export function CalendarCard({
  facility,
  reservations,
  weekStart,
  now,
  canApply,
}: Readonly<{
  facility: AvailabilityFacility;
  reservations: readonly AvailabilityReservation[];
  weekStart: Date;
  /** ローダーが読んだ現在時刻。今日の列に「いま」の線を引くのに使う */
  now: Date;
  /** 空き枠を押して申請へ進めるかどうか（COND-006） */
  canApply: boolean;
}>) {
  const days = buildWeekDays(weekStart, now);

  return (
    <Card className="min-h-0 flex-1 gap-0 overflow-hidden py-0">
      <CardHeader className="flex shrink-0 flex-wrap items-center gap-3 border-b py-4">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{facility.name}</span>
        </CardTitle>

        {canApply && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm">
                <Plus aria-hidden />
                仮予約を申請
              </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-72">
              <AvailabilityDraftCard draft={{ facility, day: null, startHour: null }} />
            </PopoverContent>
          </Popover>
        )}

        <WeekNavigation facilityId={facility.id} weekStart={weekStart} today={now} />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        <Legend />

        {/*
         * 横長の画面とスマホで別の並べ方を出している。
         * どちらを出すかは CSS の画面幅だけで決めていて、JavaScript では判定していない。
         * 画面幅を JavaScript で測ると、表示されたあとに切り替わってちらつく。
         */}
        <div className="hidden min-h-0 flex-1 md:block">
          <AvailabilityWeekGrid
            days={days}
            reservations={reservations}
            facility={facility}
            now={now}
            canApply={canApply}
          />
        </div>

        {/* スマホでは日ごとの一覧だけをスクロールさせる。上の帯（週の切り替え・凡例）は動かさない */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:hidden">
          <AvailabilityWeekAgenda
            days={days}
            reservations={reservations}
            facility={facility}
            now={now}
            canApply={canApply}
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
function Legend() {
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-xs text-muted-foreground">
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
        左端の線が太いものが自団体の予約
      </li>
      <li className="ml-auto hidden md:block">
        予約を押すと内容、空いている時間を押すとその日時で申請に進めます（{FACILITY_OPEN_HOUR}
        :00〜{FACILITY_CLOSE_HOUR}:00）
      </li>
    </ul>
  );
}
