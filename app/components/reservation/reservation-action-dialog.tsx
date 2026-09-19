import { useState, type ReactNode } from "react";
import { Form } from "react-router";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ReservationTransition } from "~/domain/reservation";
import { formatMonthDayParts, formatTime, toTokyoDateKey } from "~/lib/date";
import type { ReservationListItem } from "~/query/reservation/reservation-list";

interface ReservationActionDialogProps {
  readonly item: ReservationListItem;
  readonly transition: ReservationTransition;
  readonly showGroupName: boolean;
  readonly trigger: ReactNode;
  readonly disabled?: boolean;
}

interface DialogConfig {
  readonly title: string;
  readonly actionLabel: string;
  readonly actionVariant: "default" | "destructive";
  readonly hasReason: boolean;
  readonly isReasonRequired: boolean;
  readonly reasonLabel: string;
  readonly reasonPlaceholder: string;
}

const getDialogConfig = (transition: ReservationTransition): DialogConfig => {
  switch (transition) {
    case ReservationTransition.Withdraw:
      return {
        title: "仮予約の取り消し",
        actionLabel: "取り消す",
        actionVariant: "destructive",
        hasReason: true,
        isReasonRequired: false,
        reasonLabel: "取り消し理由（任意）",
        reasonPlaceholder: "取り消しの理由があれば入力してください",
      };
    case ReservationTransition.Cancel:
      return {
        title: "予約のキャンセル",
        actionLabel: "キャンセルする",
        actionVariant: "destructive",
        hasReason: true,
        isReasonRequired: false,
        reasonLabel: "キャンセル理由（任意）",
        reasonPlaceholder: "キャンセルの理由があれば入力してください",
      };
    case ReservationTransition.Approve:
      return {
        title: "仮予約の承認",
        actionLabel: "承認する",
        actionVariant: "default",
        hasReason: false,
        isReasonRequired: false,
        reasonLabel: "",
        reasonPlaceholder: "",
      };
    case ReservationTransition.Reject:
      return {
        title: "仮予約の却下",
        actionLabel: "却下する",
        actionVariant: "destructive",
        hasReason: true,
        isReasonRequired: true,
        reasonLabel: "却下理由",
        reasonPlaceholder: "却下の理由を入力してください",
      };
    case ReservationTransition.StaffCancel:
      return {
        title: "予約のキャンセル（事務局）",
        actionLabel: "キャンセルする",
        actionVariant: "destructive",
        hasReason: true,
        isReasonRequired: true,
        reasonLabel: "キャンセル理由",
        reasonPlaceholder: "キャンセルの理由を入力してください",
      };
  }
};

/**
 * 予約一覧の操作確認ダイアログ。
 *
 * 予約の要約（日時・施設名・人数・事務局画面では団体名）と、
 * 必要に応じた理由入力欄（却下・事務局キャンセルは COND-002 により必須）を表示する。
 *
 * `<Form method="post">` による通常のフォーム送信で構成し、JavaScript が無効でも動作する。
 */
export function ReservationActionDialog({
  item,
  transition,
  showGroupName,
  trigger,
  disabled = false,
}: Readonly<ReservationActionDialogProps>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const config = getDialogConfig(transition);
  const isSubmitDisabled = config.isReasonRequired && reason.trim() === "";

  // 日本時間での月日と曜日
  const [_, month, day] = toTokyoDateKey(item.startAt).split("-");
  const monthDayStr = `${Number(month)}/${Number(day)}`;
  const { weekday } = formatMonthDayParts(item.startAt);
  const timeStr = `${formatTime(item.startAt)} – ${formatTime(item.endAt)}`;

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild disabled={disabled}>
          {trigger}
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value={transition} />
            <input type="hidden" name="reservationId" value={item.id} />

            <AlertDialogHeader>
              <AlertDialogTitle>{config.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="mt-2 flex flex-col gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground md:text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-semibold">{item.facilityName}</span>
                    {showGroupName && (
                      <span className="text-muted-foreground">({item.groupName})</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {monthDayStr}({weekday}) {timeStr} / {item.headCount}名
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            {config.hasReason && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`reason-${item.id}-${transition}`} className="text-sm">
                  {config.reasonLabel}
                  {config.isReasonRequired && (
                    <span className="ml-1.5 text-xs font-semibold text-destructive">(必須)</span>
                  )}
                </Label>
                <Textarea
                  id={`reason-${item.id}-${transition}`}
                  name="reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={config.reasonPlaceholder}
                  required={config.isReasonRequired}
                  className="text-sm"
                />
              </div>
            )}

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button">やめる</AlertDialogCancel>
              <Button type="submit" variant={config.actionVariant} disabled={isSubmitDisabled}>
                {config.actionLabel}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック（通常のフォーム送信で成立させる） */}
      <noscript>
        <Form method="post" className="inline">
          <input type="hidden" name="intent" value={transition} />
          <input type="hidden" name="reservationId" value={item.id} />
          <Button
            type="submit"
            variant={config.actionVariant}
            size="sm"
            disabled={disabled}
            className="text-xs"
          >
            {config.actionLabel}
          </Button>
        </Form>
      </noscript>
    </>
  );
}
