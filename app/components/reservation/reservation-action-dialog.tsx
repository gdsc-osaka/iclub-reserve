import { useState, type ReactNode } from "react";
import { Form, useNavigation, type FetcherWithComponents } from "react-router";

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
import { UnlockArrangement } from "~/domain/reservation";
import { reasonTemplates } from "~/domain/reservation/reason-templates";
import { ReservationTransition } from "~/domain/reservation/transition";
import { unlockArrangementLabel } from "~/domain/reservation/unlock-arrangement";
import { formatMonthDayParts, formatTime, toTokyoDateKey } from "~/lib/date";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { ApprovalMessageField } from "./approval-message-field";
import { TransitionReasonField } from "./transition-reason-field";
import { UnlockArrangementField, unlockArrangementOptions } from "./unlock-arrangement-field";
import { useCloseAfterSubmit } from "./use-close-after-submit";

/**
 * 操作ダイアログで表示に必要な予約の項目。
 *
 * 一覧（ReservationListItem）と詳細（ReservationDetailFull）の両方から渡せるよう、
 * 実際にダイアログ内で参照している最小限の項目に絞る。
 */
export type ReservationActionTarget = Pick<
  ReservationListItem,
  "id" | "facilityName" | "groupName" | "startAt" | "endAt" | "headCount"
>;

interface ReservationActionDialogProps {
  readonly item: ReservationActionTarget;
  readonly transition: ReservationTransition;
  readonly showGroupName: boolean;
  readonly trigger: ReactNode;
  readonly disabled?: boolean;
  /**
   * 渡すと、画面全体の遷移ではなくこの fetcher で送る。
   * ダッシュボード（SCR-022）のように、行だけをその場で消したい画面で使う。
   */
  readonly fetcher?: FetcherWithComponents<unknown>;
}

interface DialogConfig {
  readonly title: string;
  readonly actionLabel: string;
  readonly actionVariant: "default" | "destructive";
  /** 理由の欄を出すか。欄を出す操作では、理由はどれも必須（COND-002） */
  readonly hasReason: boolean;
  readonly reasonLabel: string;
  readonly reasonPlaceholder: string;
  /** 解錠の手配の欄を出すか。承認では必ず選ぶ（COND-027） */
  readonly hasUnlockArrangement: boolean;
  /** 団体へのメッセージの欄を出すか。承認で任意に添える（REQ-048 / COND-023） */
  readonly hasMessage: boolean;
}

const getDialogConfig = (transition: ReservationTransition): DialogConfig => {
  switch (transition) {
    case ReservationTransition.Withdraw:
      return {
        title: "仮予約の取り消し",
        actionLabel: "取り消す",
        actionVariant: "destructive",
        hasReason: true,
        reasonLabel: "取り消し理由",
        reasonPlaceholder: "取り消しの理由を入力してください",
        hasUnlockArrangement: false,
        hasMessage: false,
      };
    case ReservationTransition.Cancel:
      return {
        title: "予約のキャンセル",
        actionLabel: "キャンセルする",
        actionVariant: "destructive",
        hasReason: true,
        reasonLabel: "キャンセル理由",
        reasonPlaceholder: "キャンセルの理由を入力してください",
        hasUnlockArrangement: false,
        hasMessage: false,
      };
    case ReservationTransition.Approve:
      return {
        title: "仮予約の承認",
        actionLabel: "承認する",
        actionVariant: "default",
        hasReason: false,
        reasonLabel: "",
        reasonPlaceholder: "",
        hasUnlockArrangement: true,
        hasMessage: true,
      };
    case ReservationTransition.Reject:
      return {
        title: "仮予約の却下",
        actionLabel: "却下する",
        actionVariant: "destructive",
        hasReason: true,
        reasonLabel: "却下理由",
        reasonPlaceholder: "却下の理由を入力してください",
        hasUnlockArrangement: false,
        hasMessage: false,
      };
    case ReservationTransition.StaffCancel:
      return {
        title: "予約のキャンセル（事務局）",
        actionLabel: "キャンセルする",
        actionVariant: "destructive",
        hasReason: true,
        reasonLabel: "キャンセル理由",
        reasonPlaceholder: "キャンセルの理由を入力してください",
        hasUnlockArrangement: false,
        hasMessage: false,
      };
  }
};

/**
 * 予約一覧の操作確認ダイアログ。
 *
 * 予約の要約（日時・施設名・人数・事務局画面では団体名）と、
 * 承認以外の操作では理由の入力欄（COND-002 により必須）を表示する。
 * 承認では、解錠の手配（COND-027 により必須）と、団体へのメッセージの欄（任意。REQ-048）を表示する。
 *
 * `<Form method="post">` による通常のフォーム送信で構成し、JavaScript が無効でも動作する。
 */
export function ReservationActionDialog({
  item,
  transition,
  showGroupName,
  trigger,
  disabled = false,
  fetcher,
}: Readonly<ReservationActionDialogProps>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [unlockArrangement, setUnlockArrangement] = useState<UnlockArrangement | null>(null);
  const [message, setMessage] = useState("");
  const navigation = useNavigation();

  const config = getDialogConfig(transition);
  const templates = reasonTemplates[transition];
  const isSubmitDisabled =
    (config.hasReason && reason.trim() === "") ||
    (config.hasUnlockArrangement && unlockArrangement === null);

  // この予約のこの操作が送信中か。同じ画面に他の予約のボタンが並ぶので、
  // intent（操作）だけでなく reservationId まで見て、押したボタンだけを見分ける
  const submission = fetcher ?? navigation;
  const isSubmitting =
    submission.state === "submitting" &&
    submission.formData?.get("intent") === transition &&
    submission.formData?.get("reservationId") === item.id;

  useCloseAfterSubmit(isSubmitting, () => setOpen(false));

  // 日本時間での月日と曜日
  const [_, month, day] = toTokyoDateKey(item.startAt).split("-");
  const monthDayStr = `${Number(month)}/${Number(day)}`;
  const { weekday } = formatMonthDayParts(item.startAt);
  const timeStr = `${formatTime(item.startAt)} – ${formatTime(item.endAt)}`;

  const FormComponent = fetcher ? fetcher.Form : Form;

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild disabled={disabled}>
          {trigger}
        </AlertDialogTrigger>
        {/*
          高さを画面に収め、はみ出す分は中でスクロールさせる。承認は解錠の手配とメッセージの欄で縦に長く、
          高さの低いスマホでは、画面の中央に置いたダイアログの上下（見出しと「承認する」）が画面の外に切れてしまうため。
        */}
        <AlertDialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
          <FormComponent method="post" className="flex flex-col gap-4">
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
              <TransitionReasonField
                idPrefix={`${item.id}-${transition}`}
                label={config.reasonLabel}
                placeholder={config.reasonPlaceholder}
                value={reason}
                onValueChange={setReason}
                templates={templates}
                note="入力した理由は、予約の詳細とお知らせのメールに載ります。この操作は元に戻せません。"
              />
            )}

            {config.hasUnlockArrangement && (
              <UnlockArrangementField
                idPrefix={`unlock-arrangement-${item.id}-${transition}`}
                value={unlockArrangement}
                onValueChange={setUnlockArrangement}
              />
            )}

            {config.hasMessage && (
              <ApprovalMessageField
                idPrefix={`${item.id}-${transition}`}
                value={message}
                onValueChange={setMessage}
                unlockArrangement={unlockArrangement}
              />
            )}

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button">やめる</AlertDialogCancel>
              <Button type="submit" variant={config.actionVariant} disabled={isSubmitDisabled}>
                {config.actionLabel}
              </Button>
            </AlertDialogFooter>
          </FormComponent>
        </AlertDialogContent>
      </AlertDialog>

      <ReservationActionNoscriptForm itemId={item.id} transition={transition} disabled={disabled} />
    </>
  );
}

/**
 * JavaScript が無効な環境向けのフォールバックフォーム（通常のフォーム送信で成立させる）。
 */
export function ReservationActionNoscriptForm({
  itemId,
  transition,
  disabled = false,
}: Readonly<{
  readonly itemId: string;
  readonly transition: ReservationTransition;
  readonly disabled?: boolean;
}>) {
  const config = getDialogConfig(transition);

  return (
    <noscript>
      <Form method="post" className="flex flex-col gap-1.5">
        <input type="hidden" name="intent" value={transition} />
        <input type="hidden" name="reservationId" value={itemId} />
        {/*
          理由の欄はダイアログと同じくここにも置く。承認以外の操作は理由が必須
          （COND-002）なので、欄が無いとサーバーに必ず弾かれ、操作を終えられない。
          定型文のボタンは JavaScript が無いと動かないため、ここでは出さない。
        */}
        {config.hasReason && (
          <>
            <Label htmlFor={`reason-noscript-${itemId}-${transition}`} className="text-xs">
              {config.reasonLabel}
            </Label>
            <Textarea
              id={`reason-noscript-${itemId}-${transition}`}
              name="reason"
              rows={2}
              placeholder={config.reasonPlaceholder}
              required
              className="text-sm"
            />
          </>
        )}
        {/*
          解錠の手配の欄はダイアログと同じくここにも置く。承認では解錠の手配が必須
          （COND-027）なので、欄が無いとサーバーに必ず弾かれ、操作を終えられない。
        */}
        {config.hasUnlockArrangement && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs">解錠の手配</legend>
            {unlockArrangementOptions.map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-xs">
                <input type="radio" name="unlockArrangement" value={option} required />
                {unlockArrangementLabel[option]}
              </label>
            ))}
          </fieldset>
        )}
        {/* 団体へのメッセージは任意だが、ダイアログで書けることは JavaScript が無くても書けるようにする */}
        {config.hasMessage && (
          <>
            <Label htmlFor={`message-noscript-${itemId}-${transition}`} className="text-xs">
              団体へのメッセージ（任意）
            </Label>
            <Textarea
              id={`message-noscript-${itemId}-${transition}`}
              name="message"
              rows={2}
              className="text-sm"
            />
          </>
        )}
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
  );
}
