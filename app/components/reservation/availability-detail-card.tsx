import type { ReactNode } from "react";
import { Link } from "react-router";

import type { AppArea } from "~/lib/app-area";
import { formatMonthDay, formatTimeRange } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ReservationActionButtons } from "./reservation-action-buttons";
import { ReservationStatusBadge } from "./reservation-status-badge";

/*
 * 空き状況カレンダー（SCR-001）の欄に出す、予約の内容。
 * 欄の仮の枠も、同じ「項目名 + 値」の並び（CardItem）で出す。
 */

/**
 * 押した予約の内容。
 *
 * タイムラインの帯には時刻と団体名しか入らないので、残りをここに出す。
 * 使用人数と備考は、申請した団体のメンバーと事務局にしか渡していない（COND-008）。
 * 渡していない相手には `detail` が `null` で届くため、
 * ここで隠しているのではなく、そもそも手元に無い。
 *
 * 事務局スタッフには実行可能な状態変更操作ボタン（承認・却下・キャンセル）を出す。
 * 予約詳細（SCR-005）へのリンクは、見ている人全員に出す。
 */
export function AvailabilityReservationCard({
  reservation,
  facilityName,
  area,
}: Readonly<{
  reservation: AvailabilityReservation;
  facilityName: string;
  area: AppArea;
}>) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ReservationStatusBadge status={reservation.status} />
        {reservation.isOwnGroup && <Badge>所属団体</Badge>}
      </div>

      <p className="text-sm font-medium break-words">{reservation.groupName}</p>

      <dl className="flex flex-col gap-1 text-sm">
        <CardItem label="日時">
          {formatMonthDay(reservation.startAt)}{" "}
          {formatTimeRange(reservation.startAt, reservation.endAt)}
        </CardItem>

        {reservation.detail !== null && (
          <>
            <CardItem label="使用人数">{reservation.detail.headCount} 名</CardItem>
            <CardItem label="備考">
              {reservation.detail.note ?? (
                <span className="font-normal text-muted-foreground">なし</span>
              )}
            </CardItem>
          </>
        )}
      </dl>

      {reservation.detail === null && (
        <p className="text-xs text-muted-foreground">
          使用人数と備考は、申請した団体のメンバーと事務局だけが見られます。
        </p>
      )}

      {/*
       * 見ている人が実行できる操作があるときは操作ボタンを出す。
       * 事務局には detail が必ず入るが、型の上で null を外してから使用する。
       */}
      {reservation.transitions.length > 0 && reservation.detail !== null && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <ReservationActionButtons
            item={{
              id: reservation.id,
              facilityName,
              groupName: reservation.groupName,
              startAt: reservation.startAt,
              endAt: reservation.endAt,
              headCount: reservation.detail.headCount,
              status: reservation.status,
              hasApprovedOverlap: reservation.hasApprovedOverlap,
            }}
            transitions={reservation.transitions}
            showGroupName={true}
          />
        </div>
      )}

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={toReservationDetailPath(area, reservation.id)}>予約の詳細を見る</Link>
      </Button>
    </div>
  );
}

/** 「項目名 + 値」を 1 組だけ表示する */
export function CardItem({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="w-18 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}
