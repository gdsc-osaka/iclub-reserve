import { ChevronRight } from "lucide-react";

import { FacilityPhoto } from "~/components/facility/facility-photo";
import { formatMonthDay } from "~/lib/date";
import { cn } from "~/lib/utils";

import { formatSlotRange } from "./reservation-slots";
import type { ScheduleDraft } from "./use-schedule-draft";

/**
 * スマホのフォームの先頭に置く、選んでいる施設・日時のカード。押すと全画面の選択が開く。
 *
 * スマホでは画面を左右に分けられないので、施設・日時を選ぶ部分は全画面の選択へ逃がし、
 * フォームにはその結果だけを出す。フォームが短くなり、申請のボタンまでスクロールせずに届く。
 */
export function ScheduleCard({
  draft,
  onOpen,
  hasError,
  describedBy,
  className,
}: Readonly<{
  draft: ScheduleDraft;
  onOpen: () => void;
  /** 施設・日時のどちらかに誤りがあるか。枠を赤くして、選び直す場所を示す */
  hasError: boolean;
  /** 誤りを出している要素の id（空白区切り）。誤りが無ければ undefined */
  describedBy: string | undefined;
  className?: string;
}>) {
  const { facility, range } = draft;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-describedby={describedBy}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl bg-card text-start ring-1 ring-foreground/10 transition-colors",
        "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        hasError && "ring-2 ring-destructive",
        className,
      )}
    >
      {/* 名前をすぐ下に書いているので、写真の代わりの文字は空にする */}
      <FacilityPhoto photoUrl={facility.photoUrl} alt="" className="aspect-[2/1] w-full" />

      <span className="flex items-center gap-3 p-4">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">施設・日時</span>
          <span className="font-medium">{facility.name}</span>
          <span className="text-sm tabular-nums">
            {formatMonthDay(draft.day)}{" "}
            {range === null ? (
              /* 時間帯を選ぶまでは申請に進めない。何をすればよいかを目立たせる */
              <span className="font-medium text-primary">時間帯を選んでください</span>
            ) : (
              formatSlotRange(range)
            )}
          </span>
        </span>

        <span className="flex shrink-0 items-center text-sm text-primary">
          変更
          <ChevronRight aria-hidden className="size-4" />
        </span>
      </span>
    </button>
  );
}
