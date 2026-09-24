import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { formatTimeRange } from "~/lib/date";

import type { ScheduleDraft } from "./use-schedule-draft";

/**
 * 選んだ時間帯が、ほかの予約と重なっているときの案内。
 *
 * 承認済みと重なっていれば申請できない（COND-001）。
 * 仮予約とだけ重なっているなら申請はできるが、どちらを承認するかは事務局が決めるので、その旨を伝える。
 *
 * 申請のボタンが押せない理由をボタンの近くで伝えるために、入力欄の側に置く。
 */
export function ScheduleConflictAlerts({
  draft,
}: Readonly<{ draft: Pick<ScheduleDraft, "approvedConflicts" | "provisionalConflicts"> }>) {
  const { approvedConflicts, provisionalConflicts } = draft;

  if (approvedConflicts.length > 0) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>この時間帯はすでに埋まっています</AlertTitle>
        <AlertDescription>
          {approvedConflicts
            .map(
              (item) =>
                `${formatTimeRange(item.reservation.startAt, item.reservation.endAt)}（${item.reservation.groupName}）`,
            )
            .join("、")}
          が承認済みです。重ねて申請することはできません（COND-001）。
        </AlertDescription>
      </Alert>
    );
  }

  if (provisionalConflicts.length > 0) {
    return <ProvisionalConflictAlert />;
  }

  return null;
}

/**
 * 同じ時間帯に、ほかの仮予約があるときの案内。
 *
 * 申請の確認ダイアログでも同じ文言を出すので、ここだけ切り出している。
 * 申請を決める直前にもう一度目に入るようにするため。
 */
export function ProvisionalConflictAlert() {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>同じ時間帯に、他の申請があります</AlertTitle>
      <AlertDescription>
        まだどちらも承認されていないので、このまま申請できます。どちらを承認するかは事務局が決めます。
      </AlertDescription>
    </Alert>
  );
}
