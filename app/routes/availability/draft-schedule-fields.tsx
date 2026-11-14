import { CalendarDays } from "lucide-react";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { DateNavigation } from "~/components/reservation/editor/date-navigation";
import { TimeRangeFields } from "~/components/reservation/editor/time-range-fields";
import { Button } from "~/components/ui/button";
import { toTokyoDateKey } from "~/lib/date";

import type { CalendarDraft } from "./paths";

/**
 * 空き状況カレンダーの欄で使う、日付と時刻の入力欄（ADR-014 決定 11・12）。
 *
 * 申請の欄（AvailabilityDraftForm）と変更の欄（AvailabilityEditForm）で共有する。
 */
export function DraftScheduleFields({
  day,
  draft,
  now,
  isBusy,
  blockedSlots,
  pastSlots,
  periodErrorId,
  onDraftChange,
  showUnselectedHint = true,
}: Readonly<{
  day: AvailabilityDay;
  draft: CalendarDraft;
  now: Date;
  isBusy: boolean;
  blockedSlots: ReadonlySet<number>;
  pastSlots: ReadonlySet<number>;
  periodErrorId?: string;
  onDraftChange: (draft: CalendarDraft) => void;
  /**
   * 時刻を選んでいないときの注記を出すか。PC の欄では出し、スマホのバーでは出さない
   * （バーの文で同じことを伝えているため）。
   * 利用できる時間帯と日をまたげないことの案内は出さない。選択肢がその範囲しか無く、見れば分かるため（ADR-014 決定 12）
   */
  showUnselectedHint?: boolean;
}>) {
  return (
    <>
      {/*
       * 日付を変えたら、時間帯はそのままで仮の枠の日を移す。予約を読み込んでいない日なら、
       * その日を基準の日にして読み直す（ADR-014 決定 11。`openDraft` が決める）
       */}
      <DateNavigation
        day={day.date}
        dateKey={draft.dateKey}
        todayKey={toTokyoDateKey(now)}
        disabled={isBusy}
        errorId={periodErrorId}
        onSelectDate={(nextDateKey) => onDraftChange({ dateKey: nextDateKey, range: draft.range })}
      />

      <div className="flex flex-col gap-1.5">
        <TimeRangeFields
          range={draft.range}
          // 欄は SetStateAction を渡してくるので、今の時間帯に当ててから仮の枠を書き換える
          onChange={(update) => {
            const nextRange = typeof update === "function" ? update(draft.range) : update;
            onDraftChange({ dateKey: draft.dateKey, range: nextRange });
          }}
          blockedSlots={blockedSlots}
          pastSlots={pastSlots}
          errorId={periodErrorId}
        />

        {showUnselectedHint && draft.range === null && (
          <p className="text-xs text-muted-foreground">
            カレンダーの空いている時間を押すか、開始時刻と終了時刻を選んでください。
          </p>
        )}
      </div>
    </>
  );
}

/**
 * スマホの入力段階の「施設・日時」グループの一番下に置く、選ぶ段階へ戻るボタン。
 *
 * 申請の欄（AvailabilityDraftForm）と変更の欄（AvailabilityEditForm）で共有する。
 */
export function RepickOnCalendarButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <Button type="button" variant="outline" onClick={onClick} className="w-full md:hidden">
      <CalendarDays aria-hidden />
      カレンダーで選び直す
    </Button>
  );
}
