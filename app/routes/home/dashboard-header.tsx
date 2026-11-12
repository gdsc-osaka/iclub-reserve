import { Calendar, Plus } from "lucide-react";
import { Link } from "react-router";

import { toNewReservationLabel } from "~/components/layout/nav-items";
import { Button } from "~/components/ui/button";
import { type AppArea, toSharedScreenPath } from "~/lib/app-area";
import { formatMonthDay, formatTime } from "~/lib/date";
import { toNewReservationPath } from "~/lib/reservation-paths";

/** 今日の日付と、よく使う画面への入口 */
export function DashboardHeader({
  now,
  area,
  showLoadedTime,
}: Readonly<{
  now: Date;
  area: AppArea;
  /** 読み込んだ時刻（「14:32 時点」）を日付の横に出すか。自動で読み直す事務局のダッシュボードで、更新が止まっていないかを見分けられるようにする。 */
  showLoadedTime?: boolean;
}>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm text-muted-foreground">
          {formatMonthDay(now)}
          {showLoadedTime && (
            <>
              {" "}
              · <time dateTime={now.toISOString()}>{formatTime(now)}</time> 時点
            </>
          )}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
      </div>
      {/* スマホでは 2 つを 2 列・全幅に並べる */}
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button asChild variant="outline" size="lg">
          <Link to={toSharedScreenPath(area, "/availability")}>
            <Calendar aria-hidden />
            空き状況を見る
          </Link>
        </Button>
        <Button asChild size="lg">
          <Link to={toNewReservationPath(area)}>
            <Plus aria-hidden />
            {toNewReservationLabel(area)}
          </Link>
        </Button>
      </div>
    </div>
  );
}
