import { useId } from "react";

import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import type { ReservationFormFacility } from "~/query/reservation/reservation-form";

import { DateNavigation } from "./date-navigation";
import { selectSlot } from "./reservation-slots";
import { ReservationTimeline, ReservationTimelineLegend } from "./reservation-timeline";
import type { ScheduleDraft } from "./use-schedule-draft";

/** 施設・日付・時間帯を選ぶ部品が共通で受け取るもの */
interface ScheduleProps {
  draft: ScheduleDraft;
  facilities: readonly ReservationFormFacility[];
  /** 表示している日の "YYYY-MM-DD"。`draft.day` と同じ日を指す */
  dateKey: string;
  todayKey: string;
  /** 読み込みの途中など、選び直させたくないときに操作を止める */
  disabled: boolean;
  /** 30 分枠 1 つ分の高さ（rem）。省略するとタイムラインの既定値 */
  slotHeightRem?: number;
  /** 施設の誤りを出している要素の id。誤りが無ければ undefined */
  facilityErrorId: string | undefined;
  /** 日時の誤りを出している要素の id。誤りが無ければ undefined */
  periodErrorId: string | undefined;
}

/**
 * 施設・日付を選び、その日の空き状況を見ながら時間帯を選ぶ部品。
 *
 * PC では申請フォームの左側にこれをそのまま置く。スマホの全画面の選択
 * （`SchedulePickerSheet`）では、上の欄（`ScheduleControls`）と
 * タイムライン（`ScheduleTimeline`）を分けて置き、タイムラインだけをスクロールさせる。
 * 入れ物と並べ方が違うだけで、中身は同じ。
 *
 * ここの欄はどれも値を送らない（`name` を付けていない）。送るのはフォームの隠し欄。
 * スマホでは、この部品がフォームの外（ダイアログ）に描かれ、閉じると消えるため。
 */
export function ReservationScheduler(props: Readonly<ScheduleProps>) {
  return (
    <div className="flex flex-col gap-4">
      <ScheduleControls {...props} />
      <ScheduleTimeline {...props} />
    </div>
  );
}

/** 施設と日付を選ぶ欄 */
export function ScheduleControls({
  draft,
  facilities,
  dateKey,
  todayKey,
  disabled,
  facilityErrorId,
  periodErrorId,
}: Readonly<ScheduleProps>) {
  const facilitySelectId = useId();

  return (
    /*
     * 横に並べるかどうかは、画面の幅ではなくこの欄が置かれた枠の幅で決める（コンテナクエリ）。
     * PC でも左の列は狭くなることがあり（サイドバーを開いた 1024px など）、
     * 画面の幅で決めると、施設の名前が入らないほど Select が細くなる。
     */
    <div className="@container">
      <div className="grid gap-3 @md:grid-cols-[minmax(0,1fr)_auto] @md:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={facilitySelectId}>施設・設備</Label>

          {/*
           * 施設を変えてもサーバーへは取りに行かない。ローダーはその日の予約を
           * 施設で絞らずに読んでいるので、必要なぶんはもう手元にある。
           *
           * 丸いボタン（空き状況カレンダーの切り替え）ではなく Select にしているのは、
           * 施設が増えたときに横へ長く並んでしまうため。
           */}
          <Select value={draft.facility.id} onValueChange={draft.setFacilityId}>
            <SelectTrigger
              id={facilitySelectId}
              className="w-full"
              aria-invalid={facilityErrorId !== undefined}
              aria-describedby={facilityErrorId}
            >
              <SelectValue placeholder="選んでください" />
            </SelectTrigger>

            {/*
             * 見出しを付けないときも、項目は `SelectGroup` で包むこと。
             *
             * この Select は「選んでいる項目の文字を、トリガーの値の文字に重ねる」
             * 置き方（radix-nova の既定 `item-aligned`）で、一覧の幅はそこから
             * 逆算される（トリガーの幅 + トリガーとの左端のずれ）。
             * つまり端をそろえているのは幅の指定ではなく、項目の左余白。
             * 包まないと `SelectGroup` の `p-1` が抜けて 4px 足りず、
             * 一覧の左端だけが内側へずれる。
             */}
            <SelectContent>
              <SelectGroup>
                {facilities.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <DateNavigation
          day={draft.day}
          dateKey={dateKey}
          todayKey={todayKey}
          facilityId={draft.facility.id}
          disabled={disabled}
          errorId={periodErrorId}
        />
      </div>
    </div>
  );
}

/** その日の空き状況を描き、枠を押して時間帯を選ぶタイムライン。色の意味と利用できる時間帯も添える */
export function ScheduleTimeline({
  draft,
  disabled,
  slotHeightRem,
}: Readonly<Pick<ScheduleProps, "draft" | "disabled" | "slotHeightRem">>) {
  return (
    <div className="flex flex-col gap-4">
      <ReservationTimeline
        day={draft.day}
        now={draft.now}
        items={draft.items}
        blockedSlots={draft.blockedSlots}
        pastSlots={draft.pastSlots}
        range={draft.range}
        disabled={disabled}
        slotHeightRem={slotHeightRem}
        onSelectSlot={(slot) =>
          draft.setRange((current) => selectSlot(current, slot, draft.blockedSlots))
        }
        onSelectRange={draft.setRange}
      />

      <ReservationTimelineLegend />

      {/* 利用できる時間帯と、日をまたげないことは画面に書いておく（SCR-002） */}
      <p className="text-xs text-muted-foreground">
        利用できるのは {FACILITY_OPEN_HOUR}:00〜{FACILITY_CLOSE_HOUR}:00
        です。日をまたぐ予約はできません。
      </p>
    </div>
  );
}
