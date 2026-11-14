import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useId, useState, type Ref } from "react";

import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { Button } from "~/components/ui/button";
import { formatMonthDay, toTokyoTimeKey } from "~/lib/date";

import {
  toDraftSummaryStatus,
  type DraftScheduleState,
  type DraftSummaryKind,
} from "./draft-schedule";
import { DraftScheduleFields } from "./draft-schedule-fields";
import type { CalendarDraft } from "./paths";

const summaryMessageByKind: Record<
  Exclude<DraftSummaryKind, "ok">,
  { readonly text: string; readonly isWarning: boolean }
> = {
  unselected: { text: "カレンダーの空いている時間を押してください。", isWarning: false },
  past: { text: "過ぎた時間は選べません。", isWarning: true },
  blocked: { text: "承認済みの予約と重なっています。", isWarning: true },
  provisional: { text: "仮予約と重なっています。", isWarning: true },
};

/**
 * スマホで仮の枠・予約の変更を選んでいる段階に出す小さなバー（ADR-014 決定 13）。
 *
 * 日時と状態だけを見せてカレンダーを広く残し、「次へ」で入力する段階へ進む。
 * 「日時を入力する」を開くと、日付の移動と開始・終了時刻の入力欄を出す（ADR-014 決定 12・13）。
 * スクリーンリーダーやキーボードを使う人、カレンダーの丸を指でドラッグしにくい人も日時を選べるようにするため。
 *
 * 入力する段階の日時の行にはこのボタンも入力欄も置かない。入力する段階はカレンダーを隠しているため、
 * そこで日時を決めると、他の予約が入っているかを見ないまま決めてしまうことになる。
 * 申請の欄（AvailabilityDraftForm）と変更の欄（AvailabilityEditForm）で共有する。
 */
export function DraftSummaryBar({
  day,
  draft,
  facilityName,
  schedule,
  now,
  isBusy,
  onDraftChange,
  onProceed,
  proceedButtonRef,
}: Readonly<{
  day: AvailabilityDay;
  draft: CalendarDraft;
  facilityName: string;
  schedule: DraftScheduleState;
  now: Date;
  isBusy: boolean;
  onDraftChange: (draft: CalendarDraft) => void;
  onProceed: () => void;
  proceedButtonRef?: Ref<HTMLButtonElement>;
}>) {
  const [isFieldsOpen, setIsFieldsOpen] = useState(false);
  const fieldsId = useId();

  const status = toDraftSummaryStatus(schedule, draft.range);
  const message =
    status.kind === "ok"
      ? { text: facilityName, isWarning: false }
      : summaryMessageByKind[status.kind];

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-1 pb-3 md:hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium tabular-nums">
            {formatMonthDay(day.date)}
            {draft.range !== null &&
              ` ${toTokyoTimeKey(draft.range.startMinutes)}〜${toTokyoTimeKey(draft.range.endMinutes)}`}
          </p>
          <p
            className={cn(
              "text-xs",
              message.isWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
          >
            {/* 注意が出た変化をスクリーンリーダーに知らせるため、role="status" の枠を常に描く */}
            <span role="status">{message.isWarning ? message.text : null}</span>
            {!message.isWarning && message.text}
          </p>
        </div>

        <Button
          ref={proceedButtonRef}
          type="button"
          disabled={!status.canProceed}
          onClick={onProceed}
        >
          次へ
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={isFieldsOpen}
        aria-controls={fieldsId}
        onClick={() => setIsFieldsOpen((prev) => !prev)}
        className="-ml-2.5 mt-1 shrink-0 self-start"
      >
        日時を入力する
        <ChevronDown
          aria-hidden
          className={cn("text-muted-foreground transition-transform", isFieldsOpen && "rotate-180")}
        />
      </Button>

      <div
        id={fieldsId}
        hidden={!isFieldsOpen}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          isFieldsOpen ? "-mx-1 mt-2 flex flex-col gap-3 px-1 pb-1" : "hidden",
        )}
      >
        {isFieldsOpen && (
          <DraftScheduleFields
            day={day}
            draft={draft}
            now={now}
            isBusy={isBusy}
            blockedSlots={schedule.blockedSlots}
            pastSlots={schedule.pastSlots}
            onDraftChange={onDraftChange}
            showUnselectedHint={false}
          />
        )}
      </div>
    </div>
  );
}
