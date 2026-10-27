import { cn } from "cn";
import { Maximize2, Minimize2, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router";

import { AvailabilityReservationCard } from "~/components/reservation/availability-detail-card";
import type { AvailabilityDay } from "~/components/reservation/availability-week";
import type { ReservationFormMode } from "~/components/reservation/editor/form-values";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { toReservationEditPath } from "~/lib/reservation-paths";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";
import type { ReservationFormGroup } from "~/query/reservation/reservation-form";

import {
  AvailabilityDraftForm,
  type CreateReservationActionError,
} from "./availability-draft-form";
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
  anchorKey,
  days,
  reservations,
  now,
  canCreateDirectly,
  applicantGroups,
  onDraftChange,
  onClose,
  createError,
  onSubmitCreate,
  isExpanded,
  onExpandedChange,
}: Readonly<{
  selection: CalendarSelection;
  facility: AvailabilityFacility;
  /** 基準の日（URL の `date`）。申請の送り先に使う */
  anchorKey: string;
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  /** 承認済みの予約を直接作成できるか（UC-008。事務局だけ） */
  canCreateDirectly: boolean;
  /** 申請元として選べる有効な団体 */
  applicantGroups: readonly ReservationFormGroup[];
  /** 仮の枠の日・時間帯を変える（欄の日付・時刻の欄から） */
  onDraftChange: (draft: CalendarDraft) => void;
  onClose: () => void;
  /** 予約を作る操作の失敗。欄の中に出す */
  createError: CreateReservationActionError | null;
  /** 欄から予約を作る操作を送ったとき */
  onSubmitCreate: (mode: ReservationFormMode) => void;
  /** スマホで欄を画面いっぱいに広げているか（ADR-014 決定 13）。カレンダーも見るので route が持つ */
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
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
       * 広げているときは高さの上限を外し、カレンダーを隠した残りの高さいっぱいに広げる（ADR-014 決定 13）。
       * PC は幅を決めて、高さは並べた箱いっぱいにする。あふれたら欄の中だけを送る。
       * 広げるのはスマホだけなので、`max-md:` だけに効かせる（PC で入力欄に入っても広げた扱いになるため）。
       */
      className={cn(
        "shrink-0 gap-0 overflow-hidden py-0 md:max-h-none md:w-80",
        isExpanded ? "max-md:flex-1" : "max-h-[45%]",
      )}
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

          {/* スマホだけ広げる・縮めるボタン（ADR-014 決定 13） */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={isExpanded ? "縮める" : "広げる"}
                onClick={() => onExpandedChange(!isExpanded)}
                className="md:hidden"
              >
                {isExpanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isExpanded ? "縮める" : "広げる"}</TooltipContent>
          </Tooltip>

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

      {selection.kind === "draft" ? (
        <AvailabilityDraftForm
          draft={selection.draft}
          facility={facility}
          anchorKey={anchorKey}
          days={days}
          reservations={reservations}
          now={now}
          canCreateDirectly={canCreateDirectly}
          applicantGroups={applicantGroups}
          onDraftChange={onDraftChange}
          createError={createError}
          onSubmitCreate={onSubmitCreate}
          onExpand={() => onExpandedChange(true)}
        />
      ) : (
        <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
          {reservation !== undefined && (
            <AvailabilityReservationCard reservation={reservation} facilityName={facility.name} />
          )}
        </CardContent>
      )}
    </Card>
  );
}
