import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

/** 予約詳細の action で、メッセージの送信を状態変更と見分けるための値 */
export const SEND_MESSAGE_INTENT = "send-message";

/** メッセージの送信で、予約詳細の action が返す形 */
export type SendMessageActionData = {
  readonly intent: typeof SEND_MESSAGE_INTENT;
  readonly sent: boolean;
  /** 本文の欄に出す誤り */
  readonly body: string | null;
  /** 欄に結び付かない誤り */
  readonly formError: string | null;
};

/**
 * 予約へのメッセージの送信欄（UC-009）。
 *
 * useFetcher で送るので、送っても画面は移らない。成功したら入力欄を空にしてトーストを出し、
 * 失敗したら入力を残したまま誤りを出す。送っている間は入力欄も止める。
 * 止めないと、送信中に書き足した分が、成功したときの空にする処理で消えてしまうため。
 *
 * 文字数の上限（COND-023）は `maxLength` で止めない。ブラウザは UTF-16 の単位で数えるので、
 * サーバーのコードポイントの数え方とずれ、絵文字を含む本文が上限より手前で止まってしまうため。
 */
export function ReservationMessageForm() {
  const fetcher = useFetcher<SendMessageActionData>();
  const formRef = useRef<HTMLFormElement>(null);

  const isSubmitting = fetcher.state !== "idle";
  const actionData = fetcher.data?.intent === SEND_MESSAGE_INTENT ? fetcher.data : undefined;
  const hasBodyError = Boolean(actionData && !actionData.sent && actionData.body);

  useEffect(() => {
    if (fetcher.data?.intent === SEND_MESSAGE_INTENT && fetcher.data.sent) {
      formRef.current?.reset();
      toast.success("メッセージを送信しました。");
    }
  }, [fetcher.data]);

  return (
    <fetcher.Form ref={formRef} method="post" className="flex flex-col gap-3">
      <input type="hidden" name="intent" value={SEND_MESSAGE_INTENT} />

      {actionData && !actionData.sent && actionData.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>送信に失敗しました</AlertTitle>
          <AlertDescription>{actionData.formError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reservation-message-body">メッセージを書く</Label>
        <Textarea
          id="reservation-message-body"
          name="body"
          required
          rows={3}
          placeholder="連絡事項や質問を入力してください"
          aria-invalid={hasBodyError ? true : undefined}
          aria-describedby={hasBodyError ? "reservation-message-body-error" : undefined}
          disabled={isSubmitting}
          className="resize-y"
        />
        {hasBodyError && (
          <p id="reservation-message-body-error" className="text-sm font-medium text-destructive">
            {actionData?.body}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        送信すると、相手方にメールで通知されます。送ったメッセージは編集も削除もできません。
      </p>

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "送信中…" : "メッセージを送信"}
        </Button>
      </div>
    </fetcher.Form>
  );
}
