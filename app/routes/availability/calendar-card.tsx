import { cn } from "cn";
import { ArrowUpLeft } from "lucide-react";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { AppArea } from "~/lib/app-area";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";

import { AvailabilityCalendar } from "./availability-calendar";
import { CalendarToolbar } from "./calendar-toolbar";
import { FacilityMenu } from "./facility-menu";
import type { CalendarDraft, CalendarSelection } from "./paths";
import type { CalendarScroll } from "./use-calendar-scroll";

/**
 * 施設 1 件の空き状況カレンダー。この画面の本体にあたる。
 *
 * 上に見出しの帯（施設・設備の切り替え、年月・前へ・今日・次へ）と凡例、その下に 4 週間ぶんのカレンダーを並べる。
 * 押した枠や予約は URL（`?draft=`・`?reservation=`）に置く（ADR-014 決定 8）。
 * 施設を切り替えても基準の日が同じなら、横の位置はそのまま残る。
 *
 * まだ施設を選んでいないときは、日付・曜日と時刻だけを並べた空のカレンダーに、
 * 左上の選択欄から施設を選ぶよう案内を重ねる（ADR-014 決定 20）。
 */
export function CalendarCard({
  facility,
  facilities,
  area,
  carriedSelection,
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
  /** いま見ている施設・設備。まだ選んでいなければ null */
  facility: AvailabilityFacility | null;
  /** 切り替えられる施設・設備の一覧 */
  facilities: readonly AvailabilityFacility[];
  /** 開いている画面。施設を切り替えるリンクに使う */
  area: AppArea;
  /** 施設を切り替えた先へ引き継ぐもの（仮の枠・変更）。無ければ undefined */
  carriedSelection: CalendarSelection | undefined;
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
        <CardTitle className="flex min-w-0 items-center text-base">
          <FacilityMenu
            facilities={facilities}
            current={facility}
            anchorKey={anchorKey}
            carriedSelection={carriedSelection}
            area={area}
          />
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
        <Legend canPickSlot={canPickSlot} className={cn(selection !== null && "max-md:hidden")} />

        <div className="relative min-h-0 flex-1">
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

          {facility === null && <FacilityPrompt />}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * まだ施設を選んでいないときに、カレンダーの真ん中に重ねる案内（ADR-014 決定 20）。
 *
 * 押せるものは置かず、選ぶのは左上の選択欄に任せる。ここにも施設の一覧を並べると、選ぶ場所が 2 つになり、
 * 選んだ後に「次はどこで切り替えるのか」が分からなくなる。
 * 下のカレンダーを横に送れるよう、案内はマウスやタッチを受け取らない。
 *
 * 置くのは日の枠の範囲（時刻の軸 `w-14` の右、日付の見出し `h-14` の下）の真ん中。
 * 軸と見出しは端に貼り付けて上に重ねて描くので（availability-calendar.tsx）、そこへかかると案内が隠れる。
 */
function FacilityPrompt() {
  return (
    <div className="pointer-events-none absolute inset-0 top-14 left-14 flex items-center justify-center p-4">
      <p className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm text-balance shadow-sm">
        <ArrowUpLeft aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {/*
         * 日本語はどの文字の間でも改行されるので、スマホの狭い幅では「左上か／ら」のように言葉の途中で切れる。
         * 文字の間では改行させず（break-keep）、句の切れ目（<wbr />）でだけ改行させる。
         */}
        <span className="break-keep">
          空き状況を
          <wbr />
          表示するには、
          <wbr />
          左上から
          <wbr />
          施設・設備を
          <wbr />
          選択してください
        </span>
      </p>
    </div>
  );
}

/**
 * 色と印の意味を説明する凡例。
 *
 * 色みでステータス、左端の線の太さで自団体かどうかを表しているので、
 * 説明が無いと「太い細いに意味があるのか」が分からない。
 *
 * 右端の案内は、日時を選べる人にだけ出す。受付の時間帯は時刻の軸を見れば分かり、
 * 押す・なぞるといった選び方は、選んでみれば分かるので書かない。
 */
function Legend({
  canPickSlot,
  className,
}: Readonly<{ canPickSlot: boolean; className?: string }>) {
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
      {canPickSlot && (
        <li className="ml-auto hidden md:block">利用したい日時を選択してください。</li>
      )}
    </ul>
  );
}
