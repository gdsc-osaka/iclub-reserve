import { cn } from "cn";
import { Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { AvailabilityReservationCard } from "~/components/reservation/availability-detail-card";
import type { AvailabilityDay } from "~/components/reservation/availability-week";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { AppArea } from "~/lib/app-area";
import type {
  AvailabilityCalendar,
  AvailabilityFacility,
} from "~/query/facility/facility-availability-calendar";
import type { ReservationEditTarget } from "~/usecases/reservation/get-reservation-edit-form";

import {
  AvailabilityDraftForm,
  type CreateReservationActionError,
} from "./availability-draft-form";
import { AvailabilityEditForm, type EditReservationActionError } from "./availability-edit-form";
import type { CalendarSelection } from "./paths";
import type { CalendarSelectionOps } from "./use-calendar-selection";

/**
 * 空き状況カレンダーで開いたもの（予約・仮の枠・予約の変更）の内容を出す欄（ADR-014 決定 7・15）。
 *
 * PC はカレンダーの右、スマホはカレンダーの下に並べ、画面に重ねない。
 * 重ねると、内容を見ながら隣の枠や帯を押して選び直せなくなる。
 */
export function AvailabilityPanel({
  calendar,
  facility,
  anchorKey,
  days,
  now,
  area,
  selection,
  selectionOps,
  createError,
  editError,
  editReservation,
  isDirectEdit,
  onSubmitCreate,
  onSubmitEdit,
  isExpanded,
  onExpandedChange,
}: Readonly<{
  calendar: AvailabilityCalendar;
  /** いま見ている施設・設備。欄は施設を選んでから開くので、必ずある */
  facility: AvailabilityFacility;
  /** 基準の日（URL の `date`）。申請・変更の送り先に使う */
  anchorKey: string;
  /** 予約を読み込んだ日（カレンダーの 4 週間と、その外で読んだ仮の枠の日）。仮の枠の日を探すのに使う */
  days: readonly AvailabilityDay[];
  now: Date;
  /** 開いている画面。欄の中の URL に使う（ADR-016 決定 15） */
  area: AppArea;
  selection: CalendarSelection;
  selectionOps: CalendarSelectionOps;
  /** 予約を作る操作の失敗。欄の中に出す */
  createError: CreateReservationActionError | null;
  /** 予約を変更する操作の失敗。欄の中に出す */
  editError: EditReservationActionError | null;
  /** 変更する予約（変更を開いているとき） */
  editReservation: ReservationEditTarget | null;
  /** 事務局による直接変更か（UC-008） */
  isDirectEdit: boolean;
  /** 欄から予約を作る操作を送ったとき */
  onSubmitCreate: () => void;
  /** 欄から予約を変更する操作を送ったとき */
  onSubmitEdit: () => void;
  /** スマホで 2 段階（選ぶ・入力する）の入力段階に進んでいるか（ADR-014 決定 13）。カレンダーを隠すので route が持つ */
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
}>) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const proceedButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldFocusProceedRef = useRef(false);

  /*
   * 閉じた状態から開いたときだけ、見出しにフォーカスを移す。
   * 欄は開いている間は描き直さず使い回すので、選び直したときはフォーカスを奪わない。
   */
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  /*
   * 入力する段階から「カレンダーで選び直す」で戻ったときは、バーの「次へ」ボタンへフォーカスを移す。
   * ボタンを押した時点ではバーがまだ描かれていないため、再描画の後に移す。
   */
  useEffect(() => {
    if (!isExpanded && shouldFocusProceedRef.current) {
      shouldFocusProceedRef.current = false;
      if (proceedButtonRef.current && !proceedButtonRef.current.disabled) {
        proceedButtonRef.current.focus({ preventScroll: true });
      } else {
        headingRef.current?.focus({ preventScroll: true });
      }
    }
  }, [isExpanded]);

  const handleProceed = () => {
    onExpandedChange(true);
    // 入力する段階へ移ると「次へ」のボタンは隠れて消えるため、見出しへフォーカスを移す
    headingRef.current?.focus({ preventScroll: true });
  };

  const handleBackToCalendar = () => {
    shouldFocusProceedRef.current = true;
    onExpandedChange(false);
  };

  const handleCancelEdit = () => {
    selectionOps.cancelEdit();
    // 変更をやめると「やめる」ボタンは消えるため、見出しへフォーカスを移す
    headingRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    /*
     * 承認・却下の確認ダイアログの中で押した Escape は、ダイアログが先に受け取って閉じる。
     * そのとき欄まで閉じないよう、ダイアログが処理済みにしたものは見送る。
     */
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    selectionOps.close();
  };

  const reservation =
    selection.kind === "reservation"
      ? calendar.reservations.find((item) => item.id === selection.reservationId)
      : undefined;

  const isSelectionBar = selection.kind !== "reservation" && !isExpanded;
  const isInputStep = selection.kind !== "reservation" && isExpanded;

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      /*
       * スマホは高さを中身に合わせ、多くても 45% まで（カレンダーを見ながら選び直せるように）。
       * 2 段階（選ぶ・入力する）の入力段階では高さの上限を外し、カレンダーを隠した残りの高さいっぱいに広げる（ADR-014 決定 13）。
       * スマホの入力段階では、全体の枠を外し、見出しを枠の外に出して中身をグループごとに囲う。
       * PC は幅を決めて、高さは並べた箱いっぱいにする。あふれたら欄の中だけを送る。
       * 広げるのはスマホだけなので、`max-md:` だけに効かせる。
       */
      className={cn(
        "shrink-0 gap-0 overflow-hidden py-0 md:max-h-none md:w-80",
        isExpanded ? "max-md:flex-1" : "max-h-[45%]",
        isInputStep && "max-md:rounded-none max-md:bg-transparent max-md:ring-0",
      )}
    >
      <CardHeader
        className={cn(
          "shrink-0 items-center",
          selection.kind === "reservation" ? "border-b py-4" : "md:border-b md:py-4",
          isSelectionBar && "max-md:pt-2 max-md:pb-0",
          isInputStep && "max-md:rounded-none max-md:px-0 max-md:pt-0 max-md:pb-3",
        )}
      >
        <CardTitle>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className={cn(
              "outline-none",
              isSelectionBar && "max-md:text-sm max-md:text-muted-foreground",
            )}
          >
            {selection.kind === "reservation"
              ? "予約の内容"
              : selection.kind === "edit"
                ? "予約の変更"
                : "新しい予約"}
          </h2>
        </CardTitle>

        <CardAction className="flex items-center gap-1 self-center">
          {/* 変更できるかはユースケースが決めている（get-availability-calendar.ts） */}
          {reservation?.canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                selectionOps.openEdit(reservation.id);
                // 変更の欄へ替わると「変更」ボタンは消えるため、見出しへフォーカスを移す
                headingRef.current?.focus({ preventScroll: true });
              }}
            >
              <Pencil aria-hidden />
              変更
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="閉じる"
                onClick={selectionOps.close}
              >
                <X aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>閉じる</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      {selection.kind === "draft" && (
        <AvailabilityDraftForm
          draft={selection.draft}
          facility={facility}
          anchorKey={anchorKey}
          days={days}
          reservations={calendar.reservations}
          now={now}
          area={area}
          canCreateDirectly={calendar.canCreateDirectly}
          applicantGroups={calendar.applicantGroups}
          onDraftChange={selectionOps.openDraft}
          createError={createError}
          onSubmitCreate={onSubmitCreate}
          isExpanded={isExpanded}
          onProceed={handleProceed}
          onRepick={handleBackToCalendar}
          proceedButtonRef={proceedButtonRef}
        />
      )}

      {selection.kind === "edit" && editReservation !== null && (
        <AvailabilityEditForm
          key={selection.reservationId}
          target={editReservation}
          isDirect={isDirectEdit}
          draft={selection.draft}
          facility={facility}
          facilities={calendar.facilities}
          anchorKey={anchorKey}
          days={days}
          reservations={calendar.reservations}
          now={now}
          area={area}
          onDraftChange={selectionOps.openDraft}
          onCancel={handleCancelEdit}
          editError={editError}
          onSubmitEdit={onSubmitEdit}
          isExpanded={isExpanded}
          onProceed={handleProceed}
          onRepick={handleBackToCalendar}
          proceedButtonRef={proceedButtonRef}
        />
      )}

      {selection.kind === "reservation" && (
        <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
          {reservation !== undefined && (
            <AvailabilityReservationCard
              reservation={reservation}
              facilityName={facility.name}
              area={area}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}
