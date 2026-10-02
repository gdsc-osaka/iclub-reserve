import { useId, type Dispatch, type SetStateAction } from "react";

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
 *
 * この欄は値を送らない（`name` を付けていない）。送るのはフォームの隠し欄で、
 * ここは選ばせるだけの部品にしている。スマホではこの欄を全画面の選択の中にも置くが、
 * そちらはフォームの外に描かれ、閉じると消えるので、ここに値を持たせると送られなくなる。
 *
 * 同じ画面に 2 つ並ぶことがある（PC 用の欄と、スマホの全画面の選択の中の欄）ので、
 * `id` は決め打ちにせず `useId` で振る。
 */
export function TimeRangeFields({
  range,
  onChange,
  blockedSlots,
  pastSlots,
  errorId,
}: Readonly<{
  range: SlotRange | null;
  onChange: Dispatch<SetStateAction<SlotRange | null>>;
  blockedSlots: ReadonlySet<number>;
  pastSlots: ReadonlySet<number>;
  /** 日時の誤りを出している要素の id。誤りが無ければ undefined */
  errorId: string | undefined;
}>) {
  const id = useId();
  const startId = `${id}-start`;
  const endId = `${id}-end`;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={startId}>開始時刻</Label>

        {/* 未選択は空文字で表す。Radix はこれを「値が無い」として扱い、placeholder を出す */}
        <Select
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
            id={startId}
            className="w-full"
            aria-invalid={errorId !== undefined}
            aria-describedby={errorId}
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
        <Label htmlFor={endId}>終了時刻</Label>

        <Select
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
            id={endId}
            className="w-full"
            aria-invalid={errorId !== undefined}
            aria-describedby={errorId}
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
