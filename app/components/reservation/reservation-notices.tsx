import { CircleAlert } from "lucide-react";

import { ReservationStatus } from "~/domain/reservation";
import { cn } from "~/lib/utils";

/**
 * 終了した予約のステータスかどうか（STATE-001）。
 *
 * 取り消し・却下・キャンセル・事務局キャンセルの 4 状態を「終了」として扱う。
 */
export const isEndedReservationStatus = (status: ReservationStatus): boolean =>
  status === ReservationStatus.Withdrawn ||
  status === ReservationStatus.Rejected ||
  status === ReservationStatus.Cancelled ||
  status === ReservationStatus.CancelledByStaff;

const isDestructiveReason = (status: ReservationStatus): boolean =>
  status === ReservationStatus.Rejected || status === ReservationStatus.CancelledByStaff;

/**
 * 理由欄の見出し。
 *
 * 状態ごとに呼び名を変える。取り消し（団体が承認前に取り下げた）と
 * キャンセル（承認後に取りやめた）は別のことなので、同じ見出しにすると
 * どちらが起きたのか分からなくなる。
 */
const reasonLabel = (status: ReservationStatus): string => {
  switch (status) {
    case ReservationStatus.Rejected:
      return "却下理由: ";
    case ReservationStatus.CancelledByStaff:
      return "事務局キャンセル理由: ";
    case ReservationStatus.Withdrawn:
      return "取り消し理由: ";
    default:
      return "キャンセル理由: ";
  }
};

/**
 * 終了した予約の理由表示（取り消し・却下・キャンセル）。
 *
 * 終了していない予約では出さない。`statusReason` は却下・キャンセルの理由を入れる欄なので
 * （INFO-001 / COND-002）、承認済みの予約に値が入っていても理由ではない。
 * 状態を見ずに中身があるかどうかだけで出すと、承認済みの行に
 * 「キャンセル理由」という見出しが付いてしまう。
 */
export function ReservationStatusReason({
  status,
  reason,
  className,
}: Readonly<{
  status: ReservationStatus;
  reason: string | null | undefined;
  className?: string;
}>) {
  if (!isEndedReservationStatus(status)) {
    return null;
  }

  if (reason === null || reason === undefined || reason.trim() === "") {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-1 rounded-md border px-2.5 py-2 text-sm",
        isDestructiveReason(status)
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium">{reasonLabel(status)}</span>
      {reason}
    </div>
  );
}

export interface ReservationOverlapNoticeArgs {
  readonly status: ReservationStatus;
  readonly hasApprovedOverlap?: boolean;
  readonly hasProvisionalOverlap?: boolean;
  readonly canApprove?: boolean;
}

/**
 * 予約の重なり案内文言を組み立てる。
 *
 * 重なりの案内は仮予約にだけ出す。承認するかどうかを決める場面と、
 * 自分の申請が通るかどうかを気にする場面が、どちらも仮予約のときだから。
 *
 * 承認済みとの重なりは承認できない（COND-001）。他の仮予約との重なりは
 * 承認を止めないが、先に承認された方だけが残るので、その旨を伝える。
 */
export const reservationOverlapNotice = ({
  status,
  hasApprovedOverlap = false,
  hasProvisionalOverlap = false,
  canApprove = false,
}: ReservationOverlapNoticeArgs): string | null => {
  const isProvisional = status === ReservationStatus.Provisional;
  const overlapsApproved = isProvisional && hasApprovedOverlap;
  const overlapsProvisional = isProvisional && hasProvisionalOverlap;

  return overlapsApproved
    ? canApprove
      ? "同一時間帯に承認済みの予約があるため承認できません"
      : "同じ時間帯に承認済みの予約があります。この申請は承認されない場合があります"
    : overlapsProvisional
      ? "同じ時間帯に他の仮予約があります。承認されるのはどちらか一方です"
      : null;
};

/**
 * 予約の重なり案内枠を表示するコンポーネント。
 */
export function ReservationOverlapNotice({
  notice,
  className,
}: Readonly<{
  notice: string | null | undefined;
  className?: string;
}>) {
  if (notice === null || notice === undefined || notice.trim() === "") {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      <span>{notice}</span>
    </div>
  );
}
