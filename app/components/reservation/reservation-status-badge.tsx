import { ReservationStatus } from "~/domain/reservation";
import { Badge, badgeVariants } from "../ui/badge";
import type { VariantProps } from "class-variance-authority";
import { Check, Ellipsis, X } from "lucide-react";
import type { JSX } from "react/jsx-runtime";

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
  {
    readonly badge: JSX.Element;
    variant: VariantProps<typeof badgeVariants>["variant"];
  }
> = {
  [ReservationStatus.Approved]: {
    badge: <Check />,
    variant: "default",
  },
  [ReservationStatus.Provisional]: {
    badge: <Ellipsis />,
    variant: "outline",
  },
  [ReservationStatus.Withdrawn]: {
    badge: <X />,
    variant: "destructive",
  },
  [ReservationStatus.Rejected]: {
    badge: <X />,
    variant: "destructive",
  },
  [ReservationStatus.Cancelled]: {
    badge: <X />,
    variant: "destructive",
  },
  [ReservationStatus.CancelledByStaff]: {
    badge: <X />,
    variant: "destructive",
  },
};

/** 予約の状態をひと目で分かるようにする小さなラベル。 */
export function ReservationStatusBadge({
  status,
  className,
}: Readonly<{ status: ReservationStatus; className?: string }>) {
  const style = reservationStatusStyle[status];

  return (
    <Badge className={className} variant={style.variant}>
      {style.badge}
      {reservationStatusLabel[status]}
    </Badge>
  );
}
