import { CircleCheck } from "lucide-react";
import { Link } from "react-router";

import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ReservationStatus } from "~/domain/reservation";
import { formatMonthDay, formatTimeRange } from "~/lib/date";
import type { CreatedReservation } from "~/query/reservation/reservation-form";

import { toCalendarPath, toFormPath } from "./paths";
import { SummaryItem } from "./summary-panel";

/**
 * 申請が終わったあとの控え。
 *
 * NOTE: 申請・承認の通知メール（EVT-001）はまだ無いので、結果の確かめ方として
 * 空き状況カレンダーを案内している。届かないメールを待たせないため。
 * 通知を実装したら、ここをメールの案内に差し替えること。
 */
export function CreatedPanel({
  created,
  facilityId,
  dateKey,
}: Readonly<{ created: CreatedReservation; facilityId: string; dateKey: string }>) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleCheck aria-hidden className="size-4 text-primary" />
          仮予約を申請しました
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          事務局が承認するまでは、まだ利用できません。承認されたかどうかは、空き状況カレンダーで確認できます。
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <SummaryItem label="団体">{created.groupName}</SummaryItem>
          <SummaryItem label="施設・設備">{created.facilityName}</SummaryItem>
          <SummaryItem label="日時">
            {`${formatMonthDay(created.startAt)} ${formatTimeRange(created.startAt, created.endAt)}`}
          </SummaryItem>
          <SummaryItem label="使用人数">{`${created.headCount} 名`}</SummaryItem>
          <SummaryItem label="備考">{created.note}</SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={toCalendarPath(facilityId, dateKey)}>空き状況カレンダーへ戻る</Link>
          </Button>

          <Button asChild variant="outline">
            <Link to={toFormPath(facilityId, dateKey)}>続けて申請する</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
