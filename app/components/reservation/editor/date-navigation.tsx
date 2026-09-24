import { ja } from "date-fns/locale/ja";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  addDays,
  formatFullDate,
  formatMonthDay,
  fromCalendarDate,
  toCalendarDate,
  toTokyoDateKey,
} from "~/lib/date";

/**
 * 利用日を選ぶ欄。前の日・次の日へ 1 日ずつ動かすボタンと、カレンダーを開くボタンを並べる。
 *
 * 選んだ日は状態に持たず、URL の `?date=` を書き換えることで伝える。
 * タイムラインに描けるのはローダーが読んだ日の予約だけなので、
 * 日付を変えることと読み直すことを切り離せない。
 *
 * パスは組み立てず、いまの URL のクエリだけを書き換える。
 * こうしておけば、申請の画面にも編集の画面にもそのまま置ける。
 *
 * `day` と `dateKey` は同じ日を指す。画面に出すには Date、
 * カレンダーとの受け渡しには文字列が要るので、両方を受け取っている。
 */
export function DateNavigation({
  day,
  dateKey,
  todayKey,
  facilityId,
  disabled,
  errorId,
}: Readonly<{
  day: Date;
  dateKey: string;
  todayKey: string;
  /** 選んでいる施設。読み直したあとも同じ施設を出せるように、URL に一緒に載せる */
  facilityId: string;
  /**
   * 日付を動かせなくする。前の読み込みが終わる前に続けて押すと、
   * まだ古い日付の URL から 1 日ずらすことになり、押した回数だけ進まない。
   */
  disabled: boolean;
  /** 日時の誤りを出している要素の id。誤りが無ければ undefined */
  errorId: string | undefined;
}>) {
  const navigate = useNavigate();
  const location = useLocation();
  const labelId = useId();
  /** 日付を選ぶカレンダーを開いているか。選んだら閉じる */
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const previousKey = toTokyoDateKey(addDays(day, -1));
  const nextKey = toTokyoDateKey(addDays(day, 1));

  /**
   * その日の URL へ移る。
   *
   * 施設も一緒に載せ直すのは、再読み込みしたときに選んでいた施設へ戻すため。
   * 施設の切り替えそのものは URL に載せていない（載せると切り替えのたびに読み直しが起きる）。
   * 開始時刻の初期値（`start`）は、別の日へ移ったら意味を失うので消す。
   *
   * 履歴に積まないのは、1 日ずつ動かすたびに「戻る」が
   * その回数ぶん必要になってしまうため。
   */
  const moveTo = (nextDateKey: string) => {
    const params = new URLSearchParams(location.search);
    params.set("facility", facilityId);
    params.set("date", nextDateKey);
    params.delete("start");

    void navigate({ search: `?${params.toString()}` }, { replace: true, preventScrollReset: true });
  };

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <p id={labelId} className="text-sm leading-none font-medium">
        日付
      </p>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="前の日"
          // 過ぎた日は選べない。今日より前へは戻れないようにする
          disabled={disabled || previousKey < todayKey}
          onClick={() => moveTo(previousKey)}
        >
          <ChevronLeft aria-hidden />
        </Button>

        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="min-w-0 flex-1 justify-between font-normal tabular-nums"
              disabled={disabled}
              /*
               * 読み上げ名をここで組み立てている。見出しの「日付」だけだと、
               * ボタンに出している日付が声では伝わらない。
               */
              aria-label={`日付 ${formatFullDate(day)}（カレンダーを開く）`}
              aria-invalid={errorId !== undefined}
              aria-describedby={errorId}
            >
              {formatMonthDay(day)}
              <CalendarDays aria-hidden className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="center" className="w-auto p-0">
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

                setIsCalendarOpen(false);
                moveTo(fromCalendarDate(selected));
              }}
            />
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="次の日"
          disabled={disabled}
          onClick={() => moveTo(nextKey)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
