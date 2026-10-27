import { Calendar, Plus } from "lucide-react";
import { Link } from "react-router";

import type { AppArea } from "~/components/layout/app-area";
import { newReservationPath, toNewReservationLabel } from "~/components/layout/nav-items";
import { Button } from "~/components/ui/button";
import { formatMonthDay } from "~/lib/date";

/** 今日の日付と、よく使う画面への入口 */
export function DashboardHeader({
  now,
  area,
}: Readonly<{
  now: Date;
  area: AppArea;
}>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm text-muted-foreground">{formatMonthDay(now)}</p>
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
      </div>
      {/* スマホでは 2 つを 2 列・全幅に並べる */}
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button asChild variant="outline" size="lg">
          <Link to="/availability">
            <Calendar aria-hidden />
            空き状況を見る
          </Link>
        </Button>
        <Button asChild size="lg">
          <Link to={newReservationPath}>
            <Plus aria-hidden />
            {toNewReservationLabel(area)}
          </Link>
        </Button>
      </div>
    </div>
  );
}
