import { CircleCheck } from "lucide-react";
import { Link } from "react-router";

import { SummaryItem } from "~/components/reservation/editor/summary-item";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ReservationStatus } from "~/domain/reservation";
import { formatMonthDay, formatTimeRange } from "~/lib/date";
import type { CreatedReservation } from "~/query/reservation/reservation-form";

import { toCalendarPath, toDetailPath, toFormPath } from "./paths";

/**
 * 申請が終わったあとの控え。
 *
 * 結果の確かめ方として、承認・却下のメール（EVT-005・EVT-006）と予約の詳細（SCR-005）を案内する。
 * 詳細へのボタンをいちばん目立たせるのは、申請した直後にいちばん見たいのが
 * 「いま出した申請がどうなっているか」だから。
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
          事務局が承認するまでは、まだ利用できません。承認・却下の結果はメールでお知らせします。申請の内容と状態は、予約の詳細からも確認できます。
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
          <SummaryItem label="備考">{created.note ?? "なし"}</SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={toDetailPath(created.id)}>予約の詳細を見る</Link>
          </Button>

          <Button asChild variant="outline">
            <Link to={toFormPath(facilityId, dateKey)}>続けて申請する</Link>
          </Button>

          <Button asChild variant="outline">
            <Link to={toCalendarPath(facilityId, dateKey)}>空き状況カレンダーへ戻る</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
