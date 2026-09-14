import { ReservationStatus } from "~/domain/reservation";
import { cn } from "~/lib/utils";

/**
 * 予約の状態を利用者向けの日本語にする。
 *
 * 表示名は必ずここを通すこと。画面ごとに文字列を書くと、
 * 同じ状態が「仮予約」「申請中」のように場所によって違う名前で出てしまう。
 */
export const reservationStatusLabel: Record<ReservationStatus, string> = {
  [ReservationStatus.Provisional]: "仮予約",
  [ReservationStatus.Approved]: "承認済み",
  [ReservationStatus.Withdrawn]: "取り消し済み",
  [ReservationStatus.Rejected]: "却下済み",
  [ReservationStatus.Cancelled]: "キャンセル済み",
  [ReservationStatus.CancelledByStaff]: "事務局キャンセル済み",
};

/**
 * 状態ごとの配色。
 *
 * 確定した枠（承認済み）とこれから決まる枠（仮予約）を、
 * 色の違いだけで見分けられるようにしている。
 * 終了した状態は空き状況カレンダーには出ないが（`calendarVisibleStatuses`）、
 * 予約一覧・予約詳細では使うので、ここで全部そろえておく。
 */
const reservationStatusStyle: Record<
  ReservationStatus,
  { readonly badge: string; readonly dot: string }
> = {
  [ReservationStatus.Approved]: {
    badge: "bg-primary/10 text-primary ring-primary/20",
    dot: "bg-primary",
  },
  [ReservationStatus.Provisional]: {
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  [ReservationStatus.Withdrawn]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
  [ReservationStatus.Rejected]: {
    badge: "bg-destructive/10 text-destructive ring-destructive/20",
    dot: "bg-destructive",
  },
  [ReservationStatus.Cancelled]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
  [ReservationStatus.CancelledByStaff]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
};

/** 予約の状態をひと目で分かるようにする小さなラベル。 */
export function ReservationStatusBadge({
  status,
  className,
}: Readonly<{ status: ReservationStatus; className?: string }>) {
  const style = reservationStatusStyle[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {reservationStatusLabel[status]}
    </span>
  );
}
