import { CircleAlert } from "lucide-react";

import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { UnlockArrangement } from "~/domain/reservation";

export interface ApprovalMessageFieldProps {
  readonly idPrefix: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** 解錠の手配。「手配済み」で空のときの注意を出すかの判定に使う（COND-027） */
  readonly unlockArrangement: UnlockArrangement | null;
}

/**
 * 承認時に団体へ送るメッセージを入力する欄（REQ-048 / COND-023）。
 *
 * 承認のダイアログと、重なりの解決ダイアログで共有する。
 */
export function ApprovalMessageField({
  idPrefix,
  value,
  onValueChange,
  unlockArrangement,
}: Readonly<ApprovalMessageFieldProps>) {
  /*
   * 「手配済み」を選ぶと、団体には「方法はメッセージを確認してください」と案内する（COND-027）。
   * 欄が空のままだと、その方法が届かないことがあるので注意を出す。前もってメッセージで
   * 伝えてあることもあるので、承認は止めない。
   */
  const showsArrangedMessageHint =
    unlockArrangement === UnlockArrangement.Arranged && value.trim() === "";

  /*
   * 団体へのメッセージ（任意。REQ-048）。承認の通知メールに載せ、メッセージの通知は別に送らない。
   * 文字数の上限（COND-023）は maxLength で止めない。理由はメッセージの送信欄
   * （ReservationMessageForm）と同じで、ブラウザとサーバーで数え方がずれるため。
   */
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`message-${idPrefix}`} className="text-sm">
        団体へのメッセージ
        <span className="font-normal text-muted-foreground">（任意）</span>
      </Label>
      <Textarea
        id={`message-${idPrefix}`}
        name="message"
        rows={3}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="カードキーの受け取り方など、承認と一緒に伝えたいことを入力してください"
        aria-describedby={
          showsArrangedMessageHint
            ? `message-note-${idPrefix} message-hint-${idPrefix}`
            : `message-note-${idPrefix}`
        }
        className="text-sm"
      />
      <p id={`message-note-${idPrefix}`} className="text-xs text-muted-foreground">
        承認のお知らせのメールに載せて、団体に届けます。送ったメッセージは編集も削除もできません。
      </p>
      {showsArrangedMessageHint && (
        <p
          id={`message-hint-${idPrefix}`}
          className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300"
        >
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            「手配済み」では、団体に解錠の方法をメッセージで確かめるよう案内します。まだ伝えていなければ、ここに書いてください。
          </span>
        </p>
      )}
    </div>
  );
}
