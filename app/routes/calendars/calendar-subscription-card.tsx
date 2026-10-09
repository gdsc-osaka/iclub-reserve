import { Check, Copy, ExternalLink, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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
  const [copied, setCopied] = useState(false);
  /*
   * 「コピー完了」を元に戻すタイマー。
   * 2 秒以内にもう一度押されたら前のタイマーを止め、最後に押してから 2 秒は表示を残す。
   * 画面を離れたときにも止める。
   */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  // Calendar ID と iCal の URL のどちらかが欠けていれば、追加も購読もできないので未設定として扱う
  const googleCalendarAddUrl = toGoogleCalendarAddUrl(facility.googleCalendarId);
  const calendarUrl = facility.calendarUrl;

  const handleCopy = async (url: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("iCal URL をクリップボードにコピーしました。");
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("URL のコピーに失敗しました。入力欄の文字を選択して手動でコピーしてください。");
    }
  };

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
            <div className="space-y-1.5 w-full min-w-0">
              <Label
                htmlFor={`ical-url-${facility.id}`}
                className="text-xs text-muted-foreground font-medium"
              >
                iCal 形式の購読 URL（Apple カレンダー・Outlook など）
              </Label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full min-w-0">
                <Input
                  id={`ical-url-${facility.id}`}
                  readOnly
                  value={calendarUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs w-full min-w-0 truncate"
                  aria-label={`${facility.name}のiCal URL`}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopy(calendarUrl)}
                  className="shrink-0 w-full sm:w-auto"
                >
                  {copied ? (
                    <>
                      <Check className="size-4 mr-1.5 text-green-600" />
                      コピー完了
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 mr-1.5" />
                      コピー
                    </>
                  )}
                </Button>
              </div>
            </div>
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
