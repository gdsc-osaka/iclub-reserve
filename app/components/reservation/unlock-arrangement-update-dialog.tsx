import { CircleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type { UnlockArrangement } from "~/domain/reservation";
import { UnlockArrangementField } from "./unlock-arrangement-field";

/** 予約詳細の action で、解錠の手配の変更をほかの操作と見分けるための値（UC-038） */
export const UPDATE_UNLOCK_ARRANGEMENT_INTENT = "updateUnlockArrangement";

/** 解錠の手配の変更で、予約詳細の action が返す形 */
export type UpdateUnlockArrangementActionData = {
  readonly intent: typeof UPDATE_UNLOCK_ARRANGEMENT_INTENT;
  readonly updated: boolean;
  /** 解錠の手配の選択欄に出す誤り */
  readonly unlockArrangement: string | null;
  /** メッセージ本文の欄に出す誤り */
  readonly message: string | null;
  /** 欄に結び付かない誤り */
  readonly formError: string | null;
};

interface UnlockArrangementUpdateDialogProps {
  /** 現在の解錠の手配の値（未定なら null） */
  readonly currentValue: UnlockArrangement | null;
  readonly trigger: ReactNode;
}

/**
 * 承認済みの予約の解錠の手配を変更するダイアログ（UC-038 / SCR-005）。
 *
 * useFetcher で送信し、成功したらダイアログを閉じる。
 * ダイアログを開き直したときは、選択値を現在の値に戻し、メッセージ欄と前回のエラー表示を消す。
 */
export function UnlockArrangementUpdateDialog({
  currentValue,
  trigger,
}: Readonly<UnlockArrangementUpdateDialogProps>) {
  const fetcher = useFetcher<UpdateUnlockArrangementActionData>();
  const [open, setOpen] = useState(false);
  const [unlockArrangement, setUnlockArrangement] = useState<UnlockArrangement | null>(
    currentValue,
  );
  const [message, setMessage] = useState("");
  const [dismissedActionData, setDismissedActionData] = useState<
    UpdateUnlockArrangementActionData | undefined
  >(undefined);

  const isSubmitting = fetcher.state !== "idle";
  const isSubmitDisabled =
    isSubmitting || unlockArrangement === null || unlockArrangement === currentValue;

  const actionData =
    fetcher.data?.intent === UPDATE_UNLOCK_ARRANGEMENT_INTENT &&
    fetcher.data !== dismissedActionData &&
    !fetcher.data.updated
      ? fetcher.data
      : undefined;

  useEffect(() => {
    if (fetcher.data?.intent === UPDATE_UNLOCK_ARRANGEMENT_INTENT && fetcher.data.updated) {
      setOpen(false);
    }
  }, [fetcher.data]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setUnlockArrangement(currentValue);
      setMessage("");
      setDismissedActionData(fetcher.data);
    }
  };

  const messageId = "update-unlock-arrangement-message";
  const messageDescriptionId = "update-unlock-arrangement-message-description";
  const messageErrorId = "update-unlock-arrangement-message-error";
  const hasMessageError = Boolean(actionData?.message);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      {/* 選ぶ欄とメッセージ欄で背が高いので、背の低いスマホでもボタンまで届くよう、画面を超えたら中をスクロールさせる */}
      <AlertDialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value={UPDATE_UNLOCK_ARRANGEMENT_INTENT} />

          <AlertDialogHeader>
            <AlertDialogTitle>解錠の手配を変更</AlertDialogTitle>
          </AlertDialogHeader>

          {actionData?.formError && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>変更に失敗しました</AlertTitle>
              <AlertDescription>{actionData.formError}</AlertDescription>
            </Alert>
          )}

          <UnlockArrangementField
            idPrefix="update-unlock-arrangement"
            value={unlockArrangement}
            onValueChange={setUnlockArrangement}
            error={actionData?.unlockArrangement ?? undefined}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={messageId} className="text-sm">
              団体へのメッセージ（任意）
            </Label>
            <Textarea
              id={messageId}
              name="message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
              aria-invalid={hasMessageError ? true : undefined}
              aria-describedby={
                hasMessageError ? `${messageDescriptionId} ${messageErrorId}` : messageDescriptionId
              }
              className="resize-y text-sm"
            />
            <p id={messageDescriptionId} className="text-xs text-muted-foreground">
              メッセージを添えると、団体にメールでお知らせします。添えなければメールは送らず、団体のダッシュボードにだけ表示されます。
            </p>
            {hasMessageError && (
              <p id={messageErrorId} className="text-sm text-destructive">
                {actionData?.message}
              </p>
            )}
          </div>

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel type="button" disabled={isSubmitting}>
              やめる
            </AlertDialogCancel>
            <Button type="submit" disabled={isSubmitDisabled}>
              変更する
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
