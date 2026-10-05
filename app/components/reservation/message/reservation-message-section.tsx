import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { ReservationMessageView } from "~/query/reservation/reservation-message-list";
import { ReservationMessageForm } from "./reservation-message-form";
import { ReservationMessageList } from "./reservation-message-list";

interface ReservationMessageSectionProps {
  readonly messages: readonly ReservationMessageView[];
}

/**
 * 予約詳細画面（SCR-005）のメッセージ欄。一覧と送信欄を縦に並べる。
 *
 * 全項目を見られる人（COND-008 の (1)）にだけ置く。予約の状態で送信欄を隠さない（COND-023）。
 * 見出しは「メッセージ」ちょうどにしておく。UC-034 の E2E が、この見出しで欄の有無を確かめている。
 */
export function ReservationMessageSection({ messages }: ReservationMessageSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">メッセージ</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ReservationMessageList messages={messages} />
        <ReservationMessageForm />
      </CardContent>
    </Card>
  );
}
