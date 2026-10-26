import { ExternalLink, Info } from "lucide-react";

import { CalendarUrlCopyField } from "~/components/calendar/calendar-url-copy-field";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { toGoogleCalendarAddUrl } from "~/domain/facility/facility-input";
import type { FacilityCalendarSubscriptionItem } from "~/query/facility/facility-calendar-subscription-list";

interface CalendarSubscriptionCardProps {
  readonly facility: FacilityCalendarSubscriptionItem;
}

/**
 * 施設・設備ごとのカレンダー購読カード。
 *
 * Google Calendar ID が設定されている場合は「Google カレンダーに追加」ボタンと
 * iCal URL のコピー欄を表示する。
 * 未設定の場合は「カレンダーはまだ用意されていません」と表示し、ボタン類は表示しない。
 */
export function CalendarSubscriptionCard({ facility }: CalendarSubscriptionCardProps) {
  // Calendar ID と iCal の URL のどちらかが欠けていれば、追加も購読もできないので未設定として扱う
  const googleCalendarAddUrl = toGoogleCalendarAddUrl(facility.googleCalendarId);
  const calendarUrl = facility.calendarUrl;

  return (
    <Card className="w-full min-w-0 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-bold break-words">
          <h2 className="text-lg font-bold">{facility.name}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {googleCalendarAddUrl !== null && calendarUrl !== null ? (
          <div className="flex flex-col gap-4">
            {/* Google カレンダーに追加ボタン */}
            <div>
              <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                <a href={googleCalendarAddUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4 mr-1.5" />
                  Google カレンダーに追加
                </a>
              </Button>
            </div>

            {/* iCal URL とコピーボタン */}
            <CalendarUrlCopyField
              id={`ical-url-${facility.id}`}
              label="iCal 形式の購読 URL（Apple カレンダー・Outlook など）"
              url={calendarUrl}
              ariaLabel={`${facility.name}のiCal URL`}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
            <Info className="size-4 shrink-0 text-muted-foreground" />
            <span>カレンダーはまだ用意されていません</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
