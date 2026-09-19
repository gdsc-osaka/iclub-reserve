import { ja } from "date-fns/locale/ja";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { formatFullDate, fromCalendarDate, toCalendarDate } from "~/lib/date";

import { toFormPath } from "./paths";

/**
 * 利用日を選ぶ欄。
 *
 * 選んだ日は状態に持たず、その日の URL へ移ることで伝える。
 * タイムラインに描けるのはローダーが読んだ日の予約だけなので、
 * 日付を変えることと読み直すことを切り離せない。
 *
 * `day` と `dateKey` は同じ日を指す。画面に出すには Date、
 * カレンダーや隠し欄との受け渡しには文字列が要るので、両方を受け取っている。
 */
export function DateField({
  day,
  dateKey,
  todayKey,
  facilityId,
  hasError,
}: Readonly<{
  day: Date;
  dateKey: string;
  todayKey: string;
  facilityId: string;
  hasError: boolean;
}>) {
  const navigate = useNavigate();
  /** 日付を選ぶカレンダーを開いているか。選んだら閉じる */
  const [isDateOpen, setIsDateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="date">日付</Label>

      {/*
       * 送るのはここ。カレンダーは入力欄ではないので、値はこの隠し欄が持つ。
       * URL の日付（＝ローダーが予約を読んだ日）をそのまま送るので、
       * 画面に出ている日と送られる日が食い違うことはない。
       */}
      <input type="hidden" name="date" value={dateKey} />

      <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className="w-full justify-between font-normal sm:max-w-64"
            /*
             * 読み上げ名をここで組み立てている。`<label for>` を付けた要素は
             * 読み上げ名がラベルの文字だけになり、ボタンに出している日付が
             * 声では伝わらなくなる（「日付、ボタン」としか読まれない）。
             */
            aria-label={`日付 ${formatFullDate(day)}`}
            aria-invalid={hasError}
            aria-describedby={hasError ? "period-error" : undefined}
          >
            {formatFullDate(day)}
            <CalendarDays aria-hidden className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={ja}
            autoFocus
            selected={toCalendarDate(dateKey)}
            defaultMonth={toCalendarDate(dateKey)}
            // 過ぎた日は選べない。送られてきた場合はドメインが弾く
            startMonth={toCalendarDate(todayKey)}
            disabled={{ before: toCalendarDate(todayKey) ?? new Date() }}
            onSelect={(selected) => {
              if (selected === undefined) return;

              setIsDateOpen(false);

              /*
               * 日付を変えることと、その日の予約を読み直すことは必ず一緒に起きる。
               * タイムラインに描けるのはローダーが読んだ日のぶんだけなので、
               * 画面の状態にだけ持たせると、空いていない時間帯が空いて見える。
               *
               * 履歴に積まないのは、1 日ずつ動かすたびに「戻る」が
               * その回数ぶん必要になってしまうため。
               */
              void navigate(toFormPath(facilityId, fromCalendarDate(selected)), {
                replace: true,
                preventScrollReset: true,
              });
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
