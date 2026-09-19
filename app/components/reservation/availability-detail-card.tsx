import type { ReactNode } from "react";

import { formatMonthDay, formatTimeRange, toTokyoTimeKey } from "~/lib/date";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import type { ReservationDraft } from "./availability-week";
import { ReservationStatusBadge } from "./reservation-status-badge";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Link } from "react-router";

/**
 * 空き状況カレンダー（SCR-001）で、押したものの中身を出す吹き出しの中身。
 *
 * 以前はカレンダーの上に差し込んでいたが、押すたびに表が上下に動いて
 * 狙っていた枠が逃げてしまうため、吹き出し（Popover）の中へ移した。
 * 吹き出しは画面に重ねて出るので、カレンダーの位置も高さも変わらない。
 *
 * デスクトップの帯・空き枠と、スマホの一覧の「＋」から同じものを開くので、
 * 中身はここに置いて両方から使う。
 */

/**
 * 予約申請フォーム（SCR-002）の URL を組み立てる。
 *
 * 押した場所で分かっていることだけをクエリに載せる。
 * 日付や時刻が決まっていないのに埋めてしまうと、
 * フォームを開いた人が「自分が選んだ値なのか」を確かめ直すことになる。
 */
const toApplicationPath = (draft: ReservationDraft): string => {
  const params = new URLSearchParams({ facility: draft.facility.id });

  if (draft.day !== null) params.set("date", draft.day.dateKey);
  if (draft.startHour !== null) params.set("start", toTokyoTimeKey(draft.startHour * 60));

  return `/reservations/new?${params.toString()}`;
};

/**
 * 押した予約の内容。
 *
 * タイムラインの帯には時刻と団体名しか入らないので、残りをここに出す。
 * 使用人数と備考は、申請した団体のメンバーと事務局にしか渡していない（COND-008）。
 * 渡していない相手には `detail` が `null` で届くため、
 * ここで隠しているのではなく、そもそも手元に無い。
 *
 * NOTE: 予約詳細（SCR-005）と事務局の承認・却下（UC-008）はまだ無いので、
 * この欄は読むだけにしている。画面ができたら、ここに導線を足すこと。
 */
export function AvailabilityReservationCard({
  reservation,
}: Readonly<{ reservation: AvailabilityReservation }>) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ReservationStatusBadge status={reservation.status} />
        {reservation.isOwnGroup && <Badge>自団体</Badge>}
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
    </div>
  );
}

/**
 * 選んだ枠を確かめる欄。
 *
 * 押した場所によって、申請フォームへ持っていける情報が変わる。
 * 何が決まっていて何がまだ決まっていないかを先に見せておかないと、
 * フォームを開いてから「日付が入っていない」と戸惑うことになる。
 *
 * NOTE: 予約申請フォーム（SCR-002）はまだ送信先のルートが無く動かないため、
 * 申請のボタンは押せない状態にしている。
 * フォームができたら、このボタンを `Link` に置き換えて
 * 施設・日付・開始時刻をクエリで渡すこと。
 */
export function AvailabilityDraftCard({ draft }: Readonly<{ draft: ReservationDraft }>) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-col gap-1 text-sm">
        <CardItem label="施設・設備">{draft.facility.name}</CardItem>
        <CardItem label="日付">
          {draft.day === null ? <Undecided /> : formatMonthDay(draft.day.date)}
        </CardItem>
        <CardItem label="開始時刻">
          {draft.startHour === null ? <Undecided /> : `${draft.startHour}:00`}
        </CardItem>
      </dl>

      {/* 送信先の画面がまだ動かないので、押せない状態で置いている */}
      <Button asChild type="button" size="sm" className="w-full" disabled>
        <Link to={toApplicationPath(draft)}>仮予約を申請</Link>
      </Button>

      <p className="text-xs text-muted-foreground">
        ここで選んだ内容は申請フォームに引き継がれます。まだ決まっていない項目はフォームで選べます。
      </p>
    </div>
  );
}

/** 「項目名 + 値」を 1 組だけ表示する */
function CardItem({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="w-18 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

/** まだ決まっていない項目。申請フォームで選ぶことになる */
function Undecided() {
  return <span className="font-normal text-muted-foreground">フォームで選ぶ</span>;
}
