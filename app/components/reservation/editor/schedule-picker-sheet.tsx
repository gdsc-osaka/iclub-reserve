import { useEffect, useRef } from "react";
import { NavigationType, useBlocker } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { ReservationFormFacility } from "~/query/reservation/reservation-form";

import { ScheduleControls, ScheduleTimeline } from "./reservation-scheduler";
import { ScheduleConflictAlerts } from "./schedule-conflict-alerts";
import { TimeRangeFields } from "./time-range-fields";
import type { ScheduleDraft } from "./use-schedule-draft";

/**
 * スマホで 30 分枠 1 つ分に取る高さ（rem）。
 *
 * PC（1.5rem = 24px）のままだと指では隣の枠を押し間違える。
 * 全画面で開くので高さに余裕があり、1 日分（24 枠）を縦にスクロールして見せる。
 */
const PICKER_SLOT_HEIGHT_REM = 2.25;

/**
 * スマホで施設・日時を選ぶ全画面の選択。中身は PC の左側（`ReservationScheduler`）と同じ。
 *
 * 選んだ内容はその場でフォームへ反映し、「決定」は閉じるだけにしている。
 * ここで日付を変えると URL が変わってローダーが読み直すので、
 * 「キャンセルで元に戻す」を置いても、日付だけは元に戻せない。戻せないものを戻せるように見せない。
 *
 * 開いている間の「戻る」（Android の戻るボタン・iOS のスワイプ）は、前の画面へ移らずに
 * この選択を閉じるだけにする。全画面で出ているので閉じるつもりで戻る人が多く、
 * そのまま前の画面へ移ると、入力していた人数や備考が消えてしまうため。
 */
export function SchedulePickerSheet({
  open,
  onOpenChange,
  draft,
  facilities,
  dateKey,
  todayKey,
  disabled,
  facilityErrorId,
  periodErrorId,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ScheduleDraft;
  facilities: readonly ReservationFormFacility[];
  dateKey: string;
  todayKey: string;
  disabled: boolean;
  facilityErrorId: string | undefined;
  periodErrorId: string | undefined;
}>) {
  /** タイムラインを縦にスクロールさせている枠 */
  const scrollRef = useRef<HTMLDivElement>(null);

  /*
   * 開いている間の「戻る」を止めて、代わりにこの選択を閉じる。
   *
   * 履歴に 1 つ積んで「戻る」で消す方法は取らない。開いたまま日付を変えると
   * 積んだ履歴だけが新しい日付になり、閉じたとき（＝戻ったとき）に古い日付へ戻ってしまう。
   * React Router は止めた「戻る」を自分で打ち消してから `blocked` にするので、
   * ここでは止めた印を片付けて閉じるだけでよい。
   */
  const blocker = useBlocker(({ historyAction }) => open && historyAction === NavigationType.Pop);

  useEffect(() => {
    if (blocker.state !== "blocked") return;

    blocker.reset();
    onOpenChange(false);
  }, [blocker, onOpenChange]);

  /**
   * 開いたときに、選んでいる時間帯（無ければ「いま」の線）が真ん中に来るまでスクロールする。
   * 夕方の枠を選び直すたびに、上から探させないため。
   *
   * `scrollIntoView` を使わないのは、スクロールを止めてある後ろのページまで動かしうるため。
   * 動かすのはこの枠の中だけにする。
   */
  const scrollToSelection = () => {
    const container = scrollRef.current;
    if (container === null) return;

    const target =
      container.querySelector<HTMLElement>('[data-slot="timeline-selection"]') ??
      container.querySelector<HTMLElement>('[data-slot="timeline-now"]');
    if (target === null) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    container.scrollTop +=
      targetRect.top - containerRect.top - (container.clientHeight - targetRect.height) / 2;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        /*
         * 画面いっぱいに広げる。`h-dvh` はアドレスバーの出入りに合わせて高さが変わる。
         * 元の `data-[side=bottom]:h-auto` のほうが詳細度が高いので、同じ条件を付けて上書きする。
         */
        className="gap-0 data-[side=bottom]:h-dvh"
        onOpenAutoFocus={(event) => {
          /*
           * 既定では先頭の操作できる要素（施設の Select）に移る。
           * スマホでは開いた瞬間に Select が選ばれた見た目になるだけなので、止めて、
           * 代わりに選択中の時間帯までスクロールする。
           */
          event.preventDefault();
          scrollToSelection();
        }}
      >
        {/*
         * 施設と日付の欄は、スクロールする枠の外（上）に置く。
         * 開いたときに選択中の時間帯までスクロールするので、同じ枠に入れると上へ隠れてしまう。
         */}
        <SheetHeader className="gap-3 border-b">
          <SheetTitle>施設・日時を選ぶ</SheetTitle>
          {/* 使い方はタイムラインの下の凡例に書いてあるので、読み上げ用にだけ置く */}
          <SheetDescription className="sr-only">
            枠を押して時間帯を選び、「決定」を押してください。
          </SheetDescription>

          <ScheduleControls
            draft={draft}
            facilities={facilities}
            dateKey={dateKey}
            todayKey={todayKey}
            disabled={disabled}
            facilityErrorId={facilityErrorId}
            periodErrorId={periodErrorId}
          />
        </SheetHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          <ScheduleTimeline
            draft={draft}
            disabled={disabled}
            slotHeightRem={PICKER_SLOT_HEIGHT_REM}
          />
        </div>

        <SheetFooter className="gap-3 border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ScheduleConflictAlerts draft={draft} />

          <TimeRangeFields
            range={draft.range}
            onChange={draft.setRange}
            blockedSlots={draft.blockedSlots}
            pastSlots={draft.pastSlots}
            errorId={periodErrorId}
          />

          <Button type="button" size="lg" onClick={() => onOpenChange(false)}>
            決定
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
