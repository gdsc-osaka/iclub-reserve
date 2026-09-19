import type { Dispatch, SetStateAction } from "react";

import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { RESERVATION_STEP_MINUTES } from "~/domain/reservation";
import { parseTokyoTimeKey, toTokyoTimeKey } from "~/lib/date";

import { endSlotMinutes, startSlotMinutes, type SlotRange } from "./reservation-slots";

/**
 * 開始時刻と終了時刻を選ぶ欄。
 *
 * タイムラインと同じ時間帯を指しているので、状態はここには置かず、
 * 呼び出し元が持つものを書き換える。片方だけ選んだときは、
 * もう片方を 1 枠ぶん（30 分）動かして必ず成り立つ組み合わせにする。
 */
export function TimeRangeFields({
  range,
  onChange,
  blockedSlots,
  pastSlots,
  hasError,
}: Readonly<{
  range: SlotRange | null;
  onChange: Dispatch<SetStateAction<SlotRange | null>>;
  blockedSlots: ReadonlySet<number>;
  pastSlots: ReadonlySet<number>;
  hasError: boolean;
}>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="start_time">開始時刻</Label>

        {/* 未選択は空文字で表す。Radix はこれを「値が無い」として扱い、placeholder を出す */}
        <Select
          name="start_time"
          required
          value={range === null ? "" : toTokyoTimeKey(range.startMinutes)}
          onValueChange={(value) => {
            const startMinutes = parseTokyoTimeKey(value);
            if (startMinutes === null) return;

            onChange((current) => ({
              startMinutes,
              endMinutes:
                current !== null && current.endMinutes > startMinutes
                  ? current.endMinutes
                  : startMinutes + RESERVATION_STEP_MINUTES,
            }));
          }}
        >
          <SelectTrigger
            id="start_time"
            className="w-full"
            aria-invalid={hasError}
            aria-describedby={hasError ? "period-error" : undefined}
          >
            <SelectValue placeholder="選んでください" />
          </SelectTrigger>

          <SelectContent>
            <SelectGroup>
              {startSlotMinutes.map((minutes) => (
                <SelectItem
                  key={minutes}
                  value={toTokyoTimeKey(minutes)}
                  disabled={blockedSlots.has(minutes) || pastSlots.has(minutes)}
                >
                  {toTokyoTimeKey(minutes)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="end_time">終了時刻</Label>

        <Select
          name="end_time"
          required
          value={range === null ? "" : toTokyoTimeKey(range.endMinutes)}
          onValueChange={(value) => {
            const endMinutes = parseTokyoTimeKey(value);
            if (endMinutes === null) return;

            onChange((current) =>
              current === null
                ? { startMinutes: endMinutes - RESERVATION_STEP_MINUTES, endMinutes }
                : { startMinutes: current.startMinutes, endMinutes },
            );
          }}
        >
          <SelectTrigger
            id="end_time"
            className="w-full"
            aria-invalid={hasError}
            aria-describedby={hasError ? "period-error" : undefined}
          >
            <SelectValue placeholder="選んでください" />
          </SelectTrigger>

          <SelectContent>
            <SelectGroup>
              {endSlotMinutes
                .filter((minutes) => range === null || minutes > range.startMinutes)
                .map((minutes) => (
                  <SelectItem key={minutes} value={toTokyoTimeKey(minutes)}>
                    {toTokyoTimeKey(minutes)}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
