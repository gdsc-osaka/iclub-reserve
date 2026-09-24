import { CalendarCheck } from "lucide-react";
import type { ReactNode } from "react";

import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { ReservationStatus } from "~/domain/reservation";
import { formatMonthDay, toTokyoTimeKey } from "~/lib/date";

/**
 * 申請内容の確認欄。
 *
 * ステータスを選ぶ欄は置いていない。申請は必ず仮予約として作られるので（STATE-001）、
 * 選べるように見せること自体が誤りになる。代わりに、そうなることをここに書いている。
 */
export function SummaryPanel({
  groupName,
  facilityName,
  day,
  range,
  headCount,
  canSubmit,
  isSubmitting,
}: Readonly<{
  groupName: string | null;
  facilityName: string | null;
  day: Date;
  range: SlotRange | null;
  headCount: string;
  canSubmit: boolean;
  isSubmitting: boolean;
}>) {
  return (
    /*
     * 貼り付ける位置は、上の帯（DesktopHeader = 3rem）の下から 1rem 空けたところ。
     * `top-4` のままだと帯の裏に潜り込み、見出しが隠れてしまう。
     * 帯は `sticky top-0 z-20` で、こちらより手前に出る。
     */
    <Card className="lg:sticky lg:top-16">
      <CardHeader>
        <CardTitle className="text-base">この内容で申請します</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <SummaryItem label="団体">{groupName}</SummaryItem>
          <SummaryItem label="施設・設備">{facilityName}</SummaryItem>
          <SummaryItem label="日付">{formatMonthDay(day)}</SummaryItem>
          <SummaryItem label="時間">
            {range === null
              ? null
              : `${toTokyoTimeKey(range.startMinutes)}〜${toTokyoTimeKey(range.endMinutes)}（${formatDuration(
                  range.endMinutes - range.startMinutes,
                )}）`}
          </SummaryItem>
          <SummaryItem label="使用人数">
            {headCount.trim() === "" ? null : `${headCount} 名`}
          </SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          申請を事務局が承認すると、利用予約が確定します。
        </p>
      </CardContent>
      <CardFooter>
        <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
          <CalendarCheck aria-hidden />
          {isSubmitting ? "申請中…" : "この内容で申請する"}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * 選んだ長さを「2 時間」「1 時間 30 分」「30 分」のように書く。
 *
 * 小数（0.5 時間）にしないのは、30 分単位で選べることが読み取れないため。
 */
const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} 分`;
  if (rest === 0) return `${hours} 時間`;

  return `${hours} 時間 ${rest} 分`;
};

/** 確認欄の「項目名 + 値」を 1 組。まだ決まっていない項目はその旨を出す */
export function SummaryItem({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">
        {children ?? <span className="font-normal text-muted-foreground">未入力</span>}
      </dd>
    </div>
  );
}
