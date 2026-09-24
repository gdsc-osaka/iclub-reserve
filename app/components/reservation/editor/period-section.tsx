import { useId } from "react";

import { formatMonthDay } from "~/lib/date";
import { cn } from "~/lib/utils";

import { formatSlotRange } from "./reservation-slots";
import { TimeRangeFields } from "./time-range-fields";
import type { ScheduleDraft } from "./use-schedule-draft";

/**
 * 選んだ日時を文字で出し、開始・終了の時刻を細かく直せる欄。PC のフォームの右側に置く。
 *
 * タイムラインで選んだ結果を、入力欄の並びの中でもう一度読めるようにしている。
 * 時刻の Select は、なぞる操作ができない人（キーボード・読み上げ）が時間帯を選ぶ手段も兼ねる。
 */
export function PeriodSection({
  draft,
  errorId,
  className,
}: Readonly<{
  draft: ScheduleDraft;
  /** 日時の誤りを出している要素の id。誤りが無ければ undefined */
  errorId: string | undefined;
  className?: string;
}>) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-sm leading-none font-medium">
          利用日時
        </h2>

        <p className="font-medium tabular-nums">
          {formatMonthDay(draft.day)}{" "}
          {draft.range === null ? (
            <span className="font-normal text-muted-foreground">時間帯は未選択</span>
          ) : (
            formatSlotRange(draft.range)
          )}
        </p>

        {draft.range === null && (
          <p className="text-sm text-muted-foreground">
            左のカレンダーの枠を押すか、下の欄で時刻を選んでください。
          </p>
        )}
      </div>

      <TimeRangeFields
        range={draft.range}
        onChange={draft.setRange}
        blockedSlots={draft.blockedSlots}
        pastSlots={draft.pastSlots}
        errorId={errorId}
      />
    </section>
  );
}
