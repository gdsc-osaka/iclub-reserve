import { Badge } from "~/components/ui/badge";
import { formatDateTime } from "~/lib/date";
import type { ReservationMessageView } from "~/query/reservation/reservation-message-list";

interface ReservationMessageListProps {
  readonly messages: readonly ReservationMessageView[];
}

/**
 * 予約へのメッセージの一覧（SCR-005）。送った順（古いものが上）に並べる。
 *
 * 送信者は、ユースケースが COND-008 に従って決めた `senderLabel` をそのまま出す。
 * 事務局としての送信を団体側が見るときは、ここに届いた時点で「事務局」になっている。
 */
export function ReservationMessageList({ messages }: ReservationMessageListProps) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">まだメッセージはありません。</p>;
  }

  return (
    <ol aria-label="メッセージの一覧" className="flex flex-col gap-3">
      {messages.map((message) => (
        <li
          key={message.id}
          className="flex flex-col gap-1.5 rounded-lg border bg-card p-3.5 text-card-foreground shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex items-center gap-2">
              {/* 送信者の要素には senderLabel だけを入れる。「あなた」は別の要素にする */}
              <span className="text-sm font-semibold text-foreground">{message.senderLabel}</span>
              {message.isMine && (
                <Badge variant="secondary" className="text-xs">
                  あなた
                </Badge>
              )}
            </div>
            <time dateTime={message.sentAt.toISOString()} className="text-xs text-muted-foreground">
              {formatDateTime(message.sentAt)}
            </time>
          </div>
          {/* 本文は利用者の入力なので、テキストとして出す。長い URL でもはみ出さないよう折り返す */}
          <p className="text-sm wrap-anywhere whitespace-pre-wrap">{message.body}</p>
        </li>
      ))}
    </ol>
  );
}
