import { CalendarPlus, CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";

import { CalendarUrlCopyField } from "~/components/calendar/calendar-url-copy-field";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  toGroupCalendarFeedGoogleCalendarUrl,
  toGroupCalendarFeedUrl,
  toGroupCalendarFeedWebcalUrl,
} from "~/domain/calendar/group-calendar-feed-url";

interface GroupCalendarFeedCardProps {
  /** 見る人自身の購読。まだ発行していなければ null */
  readonly calendarFeed: { readonly token: string } | null;
  /** 購読 URL の基底（origin） */
  readonly appBaseUrl: string;
  /** 発行・作り直しに失敗したときの文言 */
  readonly error: string | null;
}

/**
 * 自団体の予約カレンダー購読カード（SCR-007 / UC-039 / ADR-013）。
 *
 * 団体のメンバーが自分専用の購読 URL を発行・確認・作り直しできる。
 * 所属していない人には（事務局でも）出さない。出すかどうかはルートが決める。
 */
export function GroupCalendarFeedCard({
  calendarFeed,
  appBaseUrl,
  error,
}: GroupCalendarFeedCardProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>予約をカレンダーで見る</h2>
        </CardTitle>
        <CardDescription>
          この団体の仮予約と承認済みの予約を、Google
          カレンダーやお使いのカレンダーアプリに表示できます。URL
          はあなた専用で、団体を抜けると使えなくなります。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 操作失敗時のエラー表示 */}
        {error !== null && (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>操作できませんでした</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {calendarFeed === null ? (
          <Form method="post">
            <input type="hidden" name="intent" value="issue-calendar-feed" />
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? "発行中…" : "購読 URL を発行"}
            </Button>
          </Form>
        ) : (
          <IssuedCalendarFeed
            token={calendarFeed.token}
            appBaseUrl={appBaseUrl}
            isSubmitting={isSubmitting}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 発行済みの購読 URL を、カレンダーへの追加の導線・注意書き・作り直しのボタンと並べて出す。
 */
function IssuedCalendarFeed({
  token,
  appBaseUrl,
  isSubmitting,
}: {
  readonly token: string;
  readonly appBaseUrl: string;
  readonly isSubmitting: boolean;
}) {
  const googleCalendarUrl = toGroupCalendarFeedGoogleCalendarUrl(appBaseUrl, token);

  return (
    <div className="space-y-4 w-full min-w-0">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full min-w-0">
        {googleCalendarUrl !== null && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 mr-1.5" />
              Google カレンダーに追加
            </a>
          </Button>
        )}
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <a href={toGroupCalendarFeedWebcalUrl(appBaseUrl, token)}>
            <CalendarPlus className="size-4 mr-1.5" />
            カレンダーアプリで開く
          </a>
        </Button>
      </div>

      <CalendarUrlCopyField
        id="group-calendar-feed-url"
        label="購読 URL（Apple カレンダー・Outlook など）"
        url={toGroupCalendarFeedUrl(appBaseUrl, token)}
      />

      {/* URL が漏れると、ログインしなくても備考まで読める（COND-029(4)） */}
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
        <AlertDescription>
          この URL
          を知っている人は、ログインしなくても予約の備考まで読めます。人に教えたり、家族などと共有しているカレンダーに追加したりしないでください。
        </AlertDescription>
      </Alert>

      <p className="text-xs text-muted-foreground">
        予約の変更がカレンダーに反映されるまで、時間がかかることがあります（Google
        カレンダーでは数時間〜1 日ほど）。予約の状態の変化はメールでお知らせします。
      </p>

      <RegenerateCalendarFeedDialog isSubmitting={isSubmitting} />
    </div>
  );
}

/**
 * 購読 URL を作り直す確認ダイアログ。
 *
 * 送信後にダイアログを自分で閉じる処理（useEffect + hasSubmittedRef）は、
 * 招待の取り消しのダイアログ（invitation-cancel-dialog.tsx）と同じ形にしている。
 */
function RegenerateCalendarFeedDialog({ isSubmitting }: { readonly isSubmitting: boolean }) {
  const [open, setOpen] = useState(false);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (hasSubmittedRef.current) {
      hasSubmittedRef.current = false;
      setOpen(false);
    }
  }, [isSubmitting]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSubmitting}
          className="w-full sm:w-auto text-muted-foreground"
        >
          <RefreshCw className="size-3.5 mr-1.5" />
          URL を作り直す
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="regenerate-calendar-feed" />

          <AlertDialogHeader>
            <AlertDialogTitle>購読 URL を作り直しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              今の URL は使えなくなり、その URL
              で登録したカレンダーには予約が表示されなくなります。作り直した後は、新しい URL
              をカレンダーアプリに登録し直してください。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel type="button" disabled={isSubmitting}>
              キャンセル
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "処理中…" : "作り直す"}
            </Button>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
