import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { DAYS_IN_WEEK } from "~/components/reservation/availability-week";
import { Button } from "~/components/ui/button";
import { addDays, formatFullDate, formatMonthDay } from "~/lib/date";

import { toCalendarPath } from "./paths";

/** 前の週・今週・次の週への移動。あわせて表示中の期間を出す。 */
export function WeekNavigation({
  facilityId,
  weekStart,
  today,
}: Readonly<{ facilityId: string; weekStart: Date; today: Date }>) {
  const weekEnd = addDays(weekStart, DAYS_IN_WEEK - 1);

  return (
    <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground md:flex-none">
        {formatFullDate(weekStart)} 〜 {formatMonthDay(weekEnd)}
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <Button asChild variant="outline" size="icon" aria-label="前の週">
          <Link to={toCalendarPath(facilityId, addDays(weekStart, -DAYS_IN_WEEK))}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>

        <Button asChild variant="outline">
          <Link to={toCalendarPath(facilityId, today)}>今週</Link>
        </Button>

        <Button asChild variant="outline" size="icon" aria-label="次の週">
          <Link to={toCalendarPath(facilityId, addDays(weekStart, DAYS_IN_WEEK))}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
