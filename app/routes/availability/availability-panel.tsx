import { CircleAlert, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router";

import {
  AvailabilityReservationCard,
  CardItem,
} from "~/components/reservation/availability-detail-card";
import { toDayBlocks, type AvailabilityDay } from "~/components/reservation/availability-week";
import {
  formatSlotRange,
  isRangeAvailable,
  toBlockedSlots,
  toPastSlots,
} from "~/components/reservation/editor/reservation-slots";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { formatMonthDay } from "~/lib/date";
import { toReservationEditPath } from "~/lib/reservation-paths";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";
import { toFormPathForRange } from "~/routes/reservations/new/paths";

import type { CalendarDraft, CalendarSelection } from "./paths";

/**
 * 空き状況カレンダーで開いたもの（予約・仮の枠）の内容を出す欄（ADR-014 決定 7）。
 *
 * PC はカレンダーの右、スマホはカレンダーの下に並べ、画面に重ねない。
 * 重ねると、内容を見ながら隣の枠や帯を押して選び直せなくなる。
 */
export function AvailabilityPanel({
  selection,
  facility,
  days,
  reservations,
  now,
  canCreateDirectly,
  onClose,
}: Readonly<{
  selection: CalendarSelection;
  facility: AvailabilityFacility;
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  /** 承認済みの予約を直接作成できるか（UC-008。事務局だけ） */
  canCreateDirectly: boolean;
  onClose: () => void;
}>) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  /*
   * 閉じた状態から開いたときだけ、見出しにフォーカスを移す。
   * 欄は開いている間は描き直さず使い回すので、選び直したときはフォーカスを奪わない。
   */
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent) => {
    /*
     * 承認・却下の確認ダイアログの中で押した Escape は、ダイアログが先に受け取って閉じる。
     * そのとき欄まで閉じないよう、ダイアログが処理済みにしたものは見送る。
     */
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    onClose();
  };

  const reservation =
    selection.kind === "reservation"
      ? reservations.find((item) => item.id === selection.reservationId)
      : undefined;

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      /*
       * スマホは高さを中身に合わせ、多くても 45% まで（カレンダーを見ながら選び直せるように）。
       * PC は幅を決めて、高さは並べた箱いっぱいにする。あふれたら欄の中だけを送る。
       */
      className="max-h-[45%] shrink-0 gap-0 overflow-hidden py-0 md:max-h-none md:w-80"
    >
      <CardHeader className="shrink-0 items-center border-b py-4">
        <CardTitle>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="outline-none">
            {selection.kind === "reservation" ? "予約の内容" : "新しい予約"}
          </h2>
        </CardTitle>

        <CardAction className="flex items-center gap-1 self-center">
          {/* 変更できるかはユースケースが決めている（get-availability-calendar.ts） */}
          {reservation?.canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link to={toReservationEditPath(reservation.id)}>
                <Pencil aria-hidden />
                変更
              </Link>
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="閉じる"
                onClick={onClose}
              >
                <X aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>閉じる</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
        {selection.kind === "draft" ? (
          <DraftContent
            draft={selection.draft}
            facility={facility}
            days={days}
            reservations={reservations}
            now={now}
            canCreateDirectly={canCreateDirectly}
          />
        ) : (
          reservation !== undefined && (
            <AvailabilityReservationCard reservation={reservation} facilityName={facility.name} />
          )
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 仮の枠の内容と、申請フォームへ進むボタン。
 *
 * URL を書き換えた・開いている間に時間が過ぎた、などで仮の枠がもう取れないときは、
 * ボタンを出さずに選び直してもらう。フォームへ進んでから断られるより早く気付ける。
 */
function DraftContent({
  draft,
  facility,
  days,
  reservations,
  now,
  canCreateDirectly,
}: Readonly<{
  draft: CalendarDraft;
  facility: AvailabilityFacility;
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  canCreateDirectly: boolean;
}>) {
  // 開いている仮の枠の日は、読み込んだ 4 週間の中にあることを確かめてある（toOpenSelection）
  const day = days.find((item) => item.dateKey === draft.dateKey);
  if (day === undefined) return null;

  // カレンダーの 30 分の枠と同じ計算で、取れるかを決める
  const isAvailable = isRangeAvailable(
    draft.range,
    toBlockedSlots(toDayBlocks(day, reservations)),
    toPastSlots(day.date, now),
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-1 text-sm">
        <CardItem label="施設・設備">{facility.name}</CardItem>
        <CardItem label="日付">{formatMonthDay(day.date)}</CardItem>
        <CardItem label="時間">{formatSlotRange(draft.range)}</CardItem>
      </dl>

      {isAvailable ? (
        /*
         * `asChild` で中身の `Link` に見た目だけを着せている。
         * `disabled` や `type` を渡さないこと。どちらも `<a>` には効かず、
         * 押せないように見えて実際には押せる、という食い違いになる。
         */
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to={toFormPathForRange(facility.id, draft.dateKey, draft.range)}>
              この日時で申請に進む
            </Link>
          </Button>

          {canCreateDirectly && (
            <Button asChild variant="secondary" className="w-full">
              <Link to={toFormPathForRange(facility.id, draft.dateKey, draft.range, "direct")}>
                承認済みで直接作成
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
          <AlertDescription>
            この時間帯からは申請できません。カレンダーで選び直してください。
          </AlertDescription>
        </Alert>
      )}

      {/* 案内はボタンの後に置く。スマホでは欄が低いので、先に置くとボタンが欄の外に押し出される */}
      <p className="text-xs text-muted-foreground">
        団体・使用人数・備考は、申請フォームで入力します。時間帯もフォームで変えられます。
      </p>
    </div>
  );
}
