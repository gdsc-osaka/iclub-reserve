import { Check, CircleAlert, Minus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Form, useFetcher, useNavigation, type FetcherWithComponents } from "react-router";

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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { cn } from "cn";
import { UnlockArrangement } from "~/domain/reservation";
import { OVERLAP_REASON_TEMPLATE, reasonTemplates } from "~/domain/reservation/reason-templates";
import { toOverlapRejections } from "~/domain/reservation/overlap";
import { ReservationTransition } from "~/domain/reservation/transition";
import { formatMonthDay, formatTime } from "~/lib/date";
import { toOverlapResolutionPath } from "~/lib/reservation-paths";
import type {
  OverlapResolution,
  OverlapResolutionCandidate,
} from "~/query/reservation/overlap-resolution";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { ApprovalMessageField } from "./approval-message-field";
import { toOverlapPeriodLabel, toOverlapTimeline } from "./overlap-timeline";
import {
  ReservationActionDialog,
  ReservationActionNoscriptForm,
  type ReservationActionTarget,
} from "./reservation-action-dialog";
import { TransitionReasonField } from "./transition-reason-field";
import { UnlockArrangementField } from "./unlock-arrangement-field";
import { useCloseAfterSubmit } from "./use-close-after-submit";

/**
 * 団体名を「・」でつなぐ。同じ団体が重なる予約を 2 件出していることもあるので、同じ名前は 1 回だけにする。
 * 件数は「却下する予約（n 件）」とボタンの文字に出ている。
 */
const toGroupNames = (items: readonly Pick<OverlapResolutionCandidate, "groupName">[]) =>
  [...new Set(items.map((item) => item.groupName))].join("・");

export interface OverlapResolutionDialogProps {
  /** 開いた仮予約の ID。この予約を含むまとまりを読む */
  readonly reservationId: string;
  /** 初めに選んでおく予約（COND-031 (2)）。省くと先着 */
  readonly defaultWinnerId?: string;
  readonly trigger: ReactNode;
  readonly disabled?: boolean;
  /** 渡すと、画面全体の遷移ではなくこの fetcher で送る（ダッシュボード） */
  readonly fetcher?: FetcherWithComponents<unknown>;
}

/**
 * 重なり合う仮予約の解決ダイアログ（COND-031）。
 *
 * 同じ施設・時間帯に複数の仮予約が重なった際、事務局が承認する 1 件を選ぶと、
 * それと重なる仮予約をまとめて却下する。
 */
export function OverlapResolutionDialog({
  reservationId,
  defaultWinnerId,
  trigger,
  disabled = false,
  fetcher,
}: Readonly<OverlapResolutionDialogProps>) {
  const [open, setOpen] = useState(false);
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const [unlockArrangement, setUnlockArrangement] = useState<UnlockArrangement | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState<string>(OVERLAP_REASON_TEMPLATE.text);

  const overlapFetcher = useFetcher<OverlapResolution>();
  const navigation = useNavigation();

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setUserSelectedId(null);
      setUnlockArrangement(null);
      setMessage("");
      setReason(OVERLAP_REASON_TEMPLATE.text);
      void overlapFetcher.load(toOverlapResolutionPath(reservationId));
    }
    setOpen(nextOpen);
  };

  const isLoading =
    overlapFetcher.state === "loading" || (open && overlapFetcher.data === undefined);
  const candidates: readonly OverlapResolutionCandidate[] = overlapFetcher.data?.candidates ?? [];
  const isProvisionalEnded = !isLoading && open && candidates.length === 0;

  // 承認済みの予約と重ならない（選べる）候補
  const selectableCandidates = candidates.filter((c) => !c.hasApprovedOverlap);
  const defaultWinner =
    (defaultWinnerId ? selectableCandidates.find((c) => c.id === defaultWinnerId) : undefined) ??
    selectableCandidates[0];
  const winner =
    (userSelectedId ? candidates.find((c) => c.id === userSelectedId) : undefined) ?? defaultWinner;

  // 承認する予約を選んだときに、まとめて却下する予約（COND-031 (3)）
  const rejections = winner ? toOverlapRejections(winner, candidates) : [];
  const rejectionIds = new Set(rejections.map((r) => r.id));

  // 仮予約のまま残る予約
  const remaining = candidates.filter((c) => c.id !== winner?.id && !rejectionIds.has(c.id));

  // 先着の予約を却下することになるかの判定
  const firstCandidate = candidates[0];
  const isFirstRejected = firstCandidate !== undefined && rejectionIds.has(firstCandidate.id);

  // タイムラインの計算
  const timeline = toOverlapTimeline(candidates);
  const winnerBar = winner ? timeline.bars.get(winner.id) : undefined;

  // 送信中かの判定
  const submission = fetcher ?? navigation;
  const isSubmitting =
    submission.state === "submitting" &&
    submission.formData?.get("intent") === ReservationTransition.Approve &&
    submission.formData?.get("reservationId") === winner?.id;

  useCloseAfterSubmit(isSubmitting, () => setOpen(false));

  const isSubmitDisabled =
    isLoading ||
    isProvisionalEnded ||
    winner === undefined ||
    unlockArrangement === null ||
    (rejections.length > 0 && reason.trim() === "");

  // まとまり全体の日付と時間帯。候補を読むまでは null
  const periodLabel = toOverlapPeriodLabel(candidates);
  const facilityName = candidates[0]?.facilityName ?? "";

  const FormComponent = fetcher ? fetcher.Form : Form;

  const rejectedGroupNames = toGroupNames(rejections);
  const remainingGroupNames = toGroupNames(remaining);

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild disabled={disabled}>
          {trigger}
        </AlertDialogTrigger>
        <AlertDialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-5xl">
          <FormComponent method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value={ReservationTransition.Approve} />
            {winner && <input type="hidden" name="reservationId" value={winner.id} />}
            {rejections.map((rej) => (
              <input key={rej.id} type="hidden" name="rejectReservationId" value={rej.id} />
            ))}

            <AlertDialogHeader>
              <AlertDialogTitle>仮予約の承認</AlertDialogTitle>
              {periodLabel !== null && (
                <AlertDialogDescription asChild>
                  <div className="mt-2 flex flex-col gap-1 rounded-md bg-muted/60 p-3 text-xs text-foreground md:text-sm">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold">{facilityName}</span>
                      {candidates.length >= 2 && (
                        <Badge variant="outline" className="text-xs font-normal">
                          重なる仮予約 {candidates.length} 件
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground">{periodLabel}</div>
                  </div>
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>

            {isLoading && (
              <div className="p-8 text-center text-sm text-muted-foreground">読み込んでいます</div>
            )}

            {isProvisionalEnded && (
              <div className="p-8 text-center text-sm text-destructive">
                この予約は、すでに仮予約ではありません。画面を読み込み直してください。
              </div>
            )}

            {!isLoading && !isProvisionalEnded && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* 左列: 承認する予約の選択 */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <p id="overlap-winner-heading" className="text-sm font-medium">
                      承認する予約
                      <span className="ml-1.5 text-xs font-semibold text-destructive">(必須)</span>
                    </p>
                    <p id="overlap-winner-description" className="text-xs text-muted-foreground">
                      申請の早い順に並べています。選んだ予約と重なる仮予約は、まとめて却下します。
                    </p>
                  </div>

                  {/*
                    タイムラインの目盛り（一覧の上に 1 回だけ出す）。
                    下の行の帯と目盛りの位置をそろえるため、行と同じ枠線・余白・ラジオの幅を空けてから置く。
                  */}
                  {timeline.ticks.length > 0 && (
                    <div className="-mb-2 flex gap-3 border border-transparent px-3" aria-hidden>
                      <span className="size-4 shrink-0" />
                      <div className="flex min-w-0 flex-1 justify-end">
                        <div className="relative h-4 w-full text-[10px] text-muted-foreground sm:w-48 md:w-56">
                          {timeline.ticks.map((tick) => (
                            <span
                              key={tick.label}
                              className="absolute top-0 -translate-x-1/2"
                              style={{ left: `${tick.percent}%` }}
                            >
                              {tick.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <RadioGroup
                    value={winner?.id ?? ""}
                    onValueChange={setUserSelectedId}
                    aria-labelledby="overlap-winner-heading"
                    aria-describedby="overlap-winner-description"
                    aria-required
                    className="flex flex-col gap-2.5"
                  >
                    {candidates.map((candidate, index) => {
                      const isWinner = candidate.id === winner?.id;
                      const isRejected = rejectionIds.has(candidate.id);
                      const isRemaining = !isWinner && !isRejected;
                      const bar = timeline.bars.get(candidate.id);
                      const isFirst = index === 0;

                      return (
                        <div
                          key={candidate.id}
                          className={cn(
                            "flex flex-col gap-2 rounded-md border p-3 transition-colors",
                            "has-data-checked:border-primary has-data-checked:bg-primary/5",
                            candidate.hasApprovedOverlap && "opacity-60",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <RadioGroupItem
                              id={`candidate-${candidate.id}`}
                              value={candidate.id}
                              disabled={candidate.hasApprovedOverlap}
                              className="mt-1 shrink-0"
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Label
                                    htmlFor={`candidate-${candidate.id}`}
                                    className="font-semibold text-sm cursor-pointer"
                                  >
                                    {candidate.groupName}
                                  </Label>
                                  {isFirst && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                      先着
                                    </Badge>
                                  )}
                                </div>
                                <div>
                                  {isWinner && <Badge variant="default">承認する</Badge>}
                                  {isRejected && <Badge variant="destructive">却下する</Badge>}
                                  {isRemaining && <Badge variant="secondary">仮予約のまま</Badge>}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                <span>
                                  {formatTime(candidate.startAt)} – {formatTime(candidate.endAt)} ·{" "}
                                  {candidate.headCount}名
                                </span>
                                <span>
                                  申請 {formatMonthDay(candidate.requestedAt)}{" "}
                                  {formatTime(candidate.requestedAt)}
                                </span>
                              </div>

                              {candidate.note && candidate.note.trim() !== "" && (
                                <p className="line-clamp-1 text-xs text-muted-foreground">
                                  {candidate.note}
                                </p>
                              )}

                              {candidate.hasApprovedOverlap && (
                                <p className="text-xs text-destructive">
                                  承認済みの予約と重なるため、選べません
                                </p>
                              )}

                              {/* 帯（スマホでは下、sm 以上では右側に表示） */}
                              <div className="mt-1 flex items-center justify-end">
                                <div
                                  className="relative h-4 w-full rounded-sm bg-muted/40 sm:w-48 md:w-56"
                                  aria-hidden
                                >
                                  {/* 選んだ予約の時間帯を薄い主色で重ねる */}
                                  {winnerBar && (
                                    <div
                                      className="absolute top-0 bottom-0 rounded-sm bg-primary/10"
                                      style={{
                                        left: `${winnerBar.leftPercent}%`,
                                        width: `${winnerBar.widthPercent}%`,
                                      }}
                                    />
                                  )}
                                  {/* この行の予約の帯 */}
                                  {bar && (
                                    <div
                                      className={cn(
                                        "absolute top-0 bottom-0 rounded-sm",
                                        isWinner && "bg-primary",
                                        isRejected &&
                                          "border border-destructive text-destructive/40 bg-[repeating-linear-gradient(-45deg,currentColor_0,currentColor_2px,transparent_2px,transparent_6px)]",
                                        isRemaining &&
                                          "border border-dashed border-muted-foreground/60 bg-background",
                                      )}
                                      style={{
                                        left: `${bar.leftPercent}%`,
                                        width: `${bar.widthPercent}%`,
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </RadioGroup>

                  {/* 先着の予約を却下することになるときの注意 */}
                  {isFirstRejected && (
                    <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
                      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                      <span>
                        先に申請した{firstCandidate.groupName}
                        の予約を却下します。却下の理由が団体に伝わる内容か、確かめてください。
                      </span>
                    </p>
                  )}

                  {/* 枠「この操作で行うこと」 */}
                  <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-xs">
                    <p className="font-semibold text-foreground">この操作で行うこと</p>
                    <ul className="flex flex-col gap-1.5 text-muted-foreground">
                      {winner && (
                        <li className="flex items-start gap-1.5">
                          <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <span>
                            {winner.groupName}の予約を承認し、承認のお知らせをメールで送ります。
                          </span>
                        </li>
                      )}
                      {rejections.length > 0 && (
                        <li className="flex items-start gap-1.5">
                          <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                          <span>
                            {rejectedGroupNames}の予約を却下し、却下のお知らせをメールで送ります。
                          </span>
                        </li>
                      )}
                      {remaining.length > 0 && (
                        <li className="flex items-start gap-1.5">
                          <Minus
                            aria-hidden
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span>
                            {remainingGroupNames}
                            の予約は、承認する予約と重ならないため、仮予約のまま残ります。続けて承認できます。
                          </span>
                        </li>
                      )}
                    </ul>
                    {rejections.length > 0 && (
                      <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                        却下は元に戻せません。
                      </p>
                    )}
                  </div>
                </div>

                {/* 右列: 入力項目 */}
                <div className="flex flex-col gap-4 border-t pt-4 md:border-t-0 md:border-l md:pl-6 md:pt-0">
                  {winner && (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">承認する予約</p>
                      <p className="text-sm font-semibold">
                        {winner.groupName} · {formatTime(winner.startAt)} –{" "}
                        {formatTime(winner.endAt)}
                      </p>
                    </div>
                  )}

                  <UnlockArrangementField
                    idPrefix="overlap-unlock"
                    value={unlockArrangement}
                    onValueChange={setUnlockArrangement}
                  />

                  <ApprovalMessageField
                    idPrefix="overlap-message"
                    value={message}
                    onValueChange={setMessage}
                    unlockArrangement={unlockArrangement}
                  />

                  {rejections.length > 0 && (
                    <div className="flex flex-col gap-3 border-t pt-4">
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">
                          却下する予約（{rejections.length} 件）
                        </p>
                        <p className="text-xs text-muted-foreground">{rejectedGroupNames}</p>
                      </div>

                      <TransitionReasonField
                        idPrefix="overlap-reason"
                        label="却下理由"
                        placeholder="却下の理由を入力してください"
                        value={reason}
                        onValueChange={setReason}
                        templates={reasonTemplates[ReservationTransition.Reject]}
                        note="却下するすべての団体に、同じ理由を送ります。理由は予約の詳細とお知らせのメールに載ります。この操作は元に戻せません。"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button">やめる</AlertDialogCancel>
              <Button type="submit" variant="default" disabled={isSubmitDisabled}>
                {rejections.length > 0 ? `承認して ${rejections.length} 件を却下する` : "承認する"}
              </Button>
            </AlertDialogFooter>
          </FormComponent>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無いときのフォールバック */}
      <ReservationActionNoscriptForm
        itemId={reservationId}
        transition={ReservationTransition.Approve}
        disabled={disabled}
      />
    </>
  );
}

export type ReservationApproveTarget = ReservationActionTarget &
  Pick<ReservationListItem, "hasApprovedOverlap" | "hasProvisionalOverlap">;

/**
 * 承認のボタンを押したときのダイアログの入口（COND-031）。
 *
 * ほかの仮予約と重なっていて（hasProvisionalOverlap）、承認済みの予約とは重なっていないときは
 * 重なりの解決ダイアログを開き、それ以外は通常の承認確認ダイアログを開く。
 * 承認のボタンは仮予約にだけ出る（allowedTransitions）ので、ここでは状態を見ない。
 */
export function ReservationApproveDialog({
  item,
  showGroupName,
  trigger,
  disabled = false,
  fetcher,
}: Readonly<{
  readonly item: ReservationApproveTarget;
  readonly showGroupName: boolean;
  readonly trigger: ReactNode;
  readonly disabled?: boolean;
  readonly fetcher?: FetcherWithComponents<unknown>;
}>) {
  if (item.hasProvisionalOverlap && !item.hasApprovedOverlap) {
    return (
      <OverlapResolutionDialog
        reservationId={item.id}
        defaultWinnerId={item.id}
        trigger={trigger}
        disabled={disabled}
        fetcher={fetcher}
      />
    );
  }

  return (
    <ReservationActionDialog
      item={item}
      transition={ReservationTransition.Approve}
      showGroupName={showGroupName}
      trigger={trigger}
      disabled={disabled}
      fetcher={fetcher}
    />
  );
}
