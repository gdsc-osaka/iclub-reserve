import { ja } from "date-fns/locale/ja";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { fromCalendarDate, toCalendarDate } from "~/lib/date";

/**
 * カレンダーの見出しの帯。左に見えている日の年月（押すと日付を選んで移れる）、右に前へ・今日・次へ。
 *
 * 前へ・今日・次へは URL を持つリンクにせず、ボタンにする。移った先が読み込んだ 4 週間の中なら、
 * 読み直さずに横へ送るだけで済むため（use-calendar-scroll.ts）。
 */
export function CalendarToolbar({
  visibleMonths,
  anchorKey,
  onPrevious,
  onNext,
  onToday,
  onSelectDate,
}: Readonly<{
  visibleMonths: string;
  anchorKey: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelectDate: (dateKey: string) => void;
}>) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  return (
    <div className="ml-auto flex items-center gap-2">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost">
            {visibleMonths}
            <ChevronDown aria-hidden className="text-muted-foreground" />
            <span className="sr-only">（日付を選んで移動）</span>
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={ja}
            autoFocus
            selected={toCalendarDate(anchorKey)}
            defaultMonth={toCalendarDate(anchorKey)}
            onSelect={(selected) => {
              if (selected === undefined) return;
              setIsCalendarOpen(false);
              onSelectDate(fromCalendarDate(selected));
            }}
          />
        </PopoverContent>
      </Popover>

      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="前へ"
              onClick={onPrevious}
            >
              <ChevronLeft aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>前へ</TooltipContent>
        </Tooltip>

        <Button type="button" variant="outline" onClick={onToday}>
          今日
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="次へ" onClick={onNext}>
              <ChevronRight aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>次へ</TooltipContent>
        </Tooltip>
      </ButtonGroup>
    </div>
  );
}
