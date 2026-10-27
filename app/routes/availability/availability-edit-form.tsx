import { CircleAlert, ClipboardCheck } from "lucide-react";
import { useId, useState, type FocusEvent, type FormEvent } from "react";
import { Form, useNavigation } from "react-router";

import { CardItem } from "~/components/reservation/availability-detail-card";
import type { AvailabilityDay } from "~/components/reservation/availability-week";
import type { FieldErrors, FormValues } from "~/components/reservation/editor/form-values";
import {
  shouldShowApplicationNotice,
  shouldShowShortNoticeAlert,
} from "~/components/reservation/editor/notice";
import { ReservationConfirmDialog } from "~/components/reservation/editor/reservation-confirm-dialog";
import {
  HeadCountField,
  NoteField,
} from "~/components/reservation/editor/reservation-content-fields";
import { formatSlotRange, type SlotRange } from "~/components/reservation/editor/reservation-slots";
import {
  ProvisionalConflictAlert,
  ScheduleConflictAlerts,
} from "~/components/reservation/editor/schedule-conflict-alerts";
import { SummaryItem } from "~/components/reservation/editor/summary-item";
import {
  ReservationStatusBadge,
  reservationStatusLabel,
} from "~/components/reservation/reservation-status-badge";
import { UnlockArrangementField } from "~/components/reservation/unlock-arrangement-field";
import { useUnlockArrangementChoice } from "~/components/reservation/use-unlock-arrangement-choice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CardContent, CardFooter } from "~/components/ui/card";
import { FieldError } from "~/components/ui/field";
import { Separator } from "~/components/ui/separator";
import { ReservationStatus } from "~/domain/reservation";
import {
  changedContentFields,
  editTargetStatus,
  resolveDirectEditOutcome,
  resolveEditOutcome,
  ReservationEditOutcome,
  type ReservationContentField,
} from "~/domain/reservation/edit";
import { APPLICATION_DEADLINE_NOTICE, SHORT_NOTICE_ALERT } from "~/domain/reservation/lead-time";
import {
  requiresUnlockArrangementReselection,
  unlockArrangementLabel,
} from "~/domain/reservation/unlock-arrangement";
import type { AppArea } from "~/lib/app-area";
import { atTokyoMinutes, formatMonthDay, formatTime, toTokyoTimeKey } from "~/lib/date";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";
import type { ReservationEditTarget } from "~/usecases/reservation/get-reservation-edit-form";

import { calculateDraftSchedule } from "./draft-schedule";
import { DraftScheduleFields } from "./draft-schedule-fields";
import { toCalendarPath, type CalendarDraft } from "./paths";
import { excludeEditingReservation } from "./use-calendar-selection";

/** 予約を変更する操作の識別子 */
export const EDIT_RESERVATION_INTENT = "edit";

/**
 * 予約を変更する操作が失敗したときに action が返す形。
 *
 * `intent` を付けて返すのは、画面の側で作成や事務局の操作の失敗と見分けるため。
 */
export interface EditReservationActionError {
  readonly intent: typeof EDIT_RESERVATION_INTENT;
  readonly values: FormValues;
  readonly fieldErrors: FieldErrors;
  readonly formError: string | null;
}

/**
 * 空き状況カレンダーの欄で、予約の内容を変更するフォーム（ADR-014 決定 15）。
 *
 * 入力欄は CardContent の中でスクロールし、「変更内容を確認する」ボタンは CardFooter で下端に固定する。
 * 日付と時間帯は状態に持たず、URL の仮の枠（`draft`）を書き換える。カレンダーの仮の枠と同じものを指すため。
 * 使用人数・備考は、この部品の中に持つ。
 */
export function AvailabilityEditForm({
  target,
  isDirect,
  draft,
  facility,
  facilities,
  anchorKey,
  days,
  reservations,
  now,
  area,
  onDraftChange,
  onCancel,
  editError,
  onSubmitEdit,
  onExpand,
}: Readonly<{
  /** 変更前の予約情報 */
  target: ReservationEditTarget;
  /** 事務局による直接変更か（UC-008） */
  isDirect: boolean;
  draft: CalendarDraft;
  facility: AvailabilityFacility;
  facilities: readonly AvailabilityFacility[];
  /** 基準の日（URL の `date`） */
  anchorKey: string;
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  /** 開いている画面。欄の送り先の URL に使う */
  area: AppArea;
  onDraftChange: (draft: CalendarDraft) => void;
  onCancel: () => void;
  /** 予約変更の失敗情報 */
  editError: EditReservationActionError | null;
  onSubmitEdit: () => void;
  onExpand: () => void;
}>) {
  const formId = useId();
  const periodErrorId = useId();
  const facilityErrorId = useId();

  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isBusy = navigation.state !== "idle";

  // 送って戻ってきたときは、送った値を初期値にする
  const submitted = editError?.values ?? null;
  const fieldErrors = editError?.fieldErrors ?? {};
  const formError = editError?.formError ?? null;

  const [headCount, setHeadCount] = useState(submitted?.headCount ?? String(target.headCount));
  const [note, setNote] = useState(submitted?.note ?? target.note ?? "");

  /*
   * 選んだ解錠の手配（COND-027）。承認済みの予約の施設・日時を直接変更するときに選ぶ。
   * 選んだあとで施設・日時を変えたら、未選択に戻る（`useUnlockArrangementChoice`）。
   */
  const [unlockArrangement, selectUnlockArrangement] = useUnlockArrangementChoice(
    { facilityId: facility.id, dateKey: draft.dateKey, range: draft.range },
    submitted?.unlockArrangement ?? null,
  );
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // 開いている仮の枠の日は、読み込んだ 4 週間の中にあることを確かめてある（toOpenSelection）
  const day = days.find((item) => item.dateKey === draft.dateKey);
  if (day === undefined) return null;

  /*
   * 変更を開いているときは、変更する予約そのものを除いて重なりや押せない枠を数える（ADR-014 決定 15）。
   * 除かないと自分自身と重なってしまうため。
   */
  const { blockedSlots, pastSlots, isAvailable, isStartPast, conflicts } = calculateDraftSchedule({
    draft,
    day,
    reservations: excludeEditingReservation(reservations, target.id),
    now,
  });

  /** 変更のとき、いまの入力で何が変わり、予約がどうなるか。まだ比べられないときは null */
  const editPreview = toEditPreview(
    target,
    facility.id,
    day.date,
    draft.range,
    headCount,
    note,
    isDirect,
  );

  /** 1 項目も変えていない。送っても何も起きないので、確認へ進ませない */
  const isUnchanged = editPreview?.outcome === ReservationEditOutcome.NoChange;

  /** 承認済みの予約の施設・日時を変えたので、仮予約に戻る（COND-005。直接変更では仮予約に戻らない） */
  const needsReapproval = !isDirect && editPreview?.outcome === ReservationEditOutcome.Reapproval;

  /** 申請の期限の目安（COND-028）の、いつも出す案内と、7 日を切ったときの注意を出すか */
  const noticeContext = {
    kind: "edit",
    isDirect,
    outcome: editPreview?.outcome ?? null,
  } as const;
  const showApplicationNotice = shouldShowApplicationNotice(noticeContext);
  const showShortNotice = shouldShowShortNoticeAlert(
    noticeContext,
    draft.range === null ? null : atTokyoMinutes(day.date, draft.range.startMinutes),
    now,
  );

  /*
   * 解錠の手配（COND-027）の欄を出すか。承認済みの予約の施設・日時を直接変更するときだけ出す
   * （判定は action と同じドメインの関数）。
   * 欄を消したときは、選んでいた値も送らない（欄ごと消えるので、ラジオの値も送られない）。
   */
  const showUnlockArrangement =
    isDirect &&
    editPreview !== null &&
    requiresUnlockArrangementReselection(target.status, editPreview.changed);
  /** 解錠の手配の欄を出しているのに、まだ選んでいない。確認へ進ませない */
  const isUnlockArrangementMissing = showUnlockArrangement && unlockArrangement === null;

  /*
   * 確認へ進めるのは、時刻を選んでいて取れる時間帯で、画面が次の状態へ移っている最中でなく、
   * 1 項目以上変えていて、解錠の手配の欄を出していればそれを選んでいるときだけ。
   * 承認済みとの重なりは、取れるかに含まれる。
   * 止めるときは、その理由（時刻を選んでいない・過ぎている・埋まっている）をボタンより上に、
   * 何も変えていないことと解錠の手配を選んでいないことをボタンのすぐ上に出している。
   */
  const canConfirm = isAvailable && !isBusy && !isUnchanged && !isUnlockArrangementMissing;

  /** 変更前の施設名。確認のダイアログや一覧で「変更前」を添えるために使う */
  const originalFacility = facilities.find((item) => item.id === target.facilityId) ?? null;

  /*
   * 確認のダイアログに出す、送ったあとの状態。
   * 変更では、どの項目を変えたかで承認済みのままか仮予約に戻るかが決まる（COND-005）。
   */
  const statusAfterSubmit: ReservationStatus =
    editPreview === null || editPreview.outcome === ReservationEditOutcome.NoChange
      ? target.status
      : editTargetStatus[editPreview.outcome];

  /*
   * 「変更内容を確認する」では送らずに、確認のダイアログを開く。ダイアログから送ったときだけ、そのまま送る。
   * 「変更内容を確認する」を送信のボタンにしているのは、必須の欄が空のままならブラウザが先に止めて、
   * その欄を示してくれるため。
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!isConfirmOpen) {
      event.preventDefault();
      setIsConfirmOpen(true);
      return;
    }
    onSubmitEdit();
  };

  /*
   * 文字を打つ欄に入ったら、スマホでは欄を広げる（ADR-014 決定 13）。
   * キーボードが出ると、45% の高さの欄では打っている欄が隠れてしまうため。
   */
  const handleFocus = (event: FocusEvent<HTMLFormElement>) => {
    const focusTarget = event.target;
    if (
      (focusTarget instanceof HTMLInputElement && focusTarget.type !== "hidden") ||
      focusTarget instanceof HTMLTextAreaElement
    ) {
      onExpand();
    }
  };

  return (
    <>
      <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
        {/*
         * replace を付けるのは、成功の転送で変更を開いていた履歴を置き換えるため（ADR-014 決定 10）。
         * 送り先は、今の URL に任せず組み立てる（申請の欄と同じ理由）。
         */}
        <Form
          method="post"
          action={toCalendarPath(area, facility.id, anchorKey, {
            kind: "edit",
            reservationId: target.id,
            draft,
          })}
          replace
          id={formId}
          onSubmit={handleSubmit}
          onFocus={handleFocus}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="intent" value={EDIT_RESERVATION_INTENT} />
          <input type="hidden" name="facility_id" value={facility.id} />
          <input type="hidden" name="date" value={draft.dateKey} />
          <input
            type="hidden"
            name="start_time"
            value={draft.range === null ? "" : toTokyoTimeKey(draft.range.startMinutes)}
          />
          <input
            type="hidden"
            name="end_time"
            value={draft.range === null ? "" : toTokyoTimeKey(draft.range.endMinutes)}
          />

          {formError !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden className="size-4" />
              <AlertTitle>変更できませんでした</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <dl className="flex flex-col gap-1 text-sm">
            <CardItem label="施設・設備">
              <div className="flex flex-col">
                <span>{facility.name}</span>
                {originalFacility !== null && originalFacility.id !== facility.id && (
                  <span className="text-xs font-normal text-muted-foreground">
                    変更前: {originalFacility.name}
                  </span>
                )}
              </div>
            </CardItem>
            {/*
             * 変更では団体を変えられないので、名前を出すだけにする。
             * group_id も送らない（`ReservationContent` を参照）。
             */}
            <CardItem label="団体">{target.groupName}</CardItem>
          </dl>

          <DraftScheduleFields
            day={day}
            draft={draft}
            now={now}
            isBusy={isBusy}
            blockedSlots={blockedSlots}
            pastSlots={pastSlots}
            periodErrorId={fieldErrors.period ? periodErrorId : undefined}
            onDraftChange={onDraftChange}
          />

          <FieldError id={periodErrorId}>{fieldErrors.period}</FieldError>
          <FieldError id={facilityErrorId}>{fieldErrors.facilityId}</FieldError>

          {/* 1 週間前までの案内の注意（COND-028） */}
          {showApplicationNotice && (
            <p className="text-xs text-muted-foreground">{APPLICATION_DEADLINE_NOTICE}</p>
          )}

          {isStartPast ? (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
              <AlertDescription>
                過ぎた日時には変更できません。日時を選び直してください。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 7 日を切ったときの注意（COND-028） */}
              {showShortNotice && (
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
                  <AlertDescription>{SHORT_NOTICE_ALERT}</AlertDescription>
                </Alert>
              )}
              {conflicts !== null && <ScheduleConflictAlerts conflicts={conflicts} />}
            </>
          )}

          {needsReapproval && <ReapprovalAlert />}
          {isDirect && <DirectEditAlert />}

          {showUnlockArrangement && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                承認済みの予約の施設・日時を変えるので、解錠の手配を選び直してください。
              </p>
              <UnlockArrangementField
                idPrefix="direct-edit"
                value={unlockArrangement}
                onValueChange={selectUnlockArrangement}
                error={fieldErrors.unlockArrangement}
              />
            </div>
          )}

          <Separator />

          <HeadCountField value={headCount} onChange={setHeadCount} error={fieldErrors.headCount} />

          <NoteField value={note} onChange={setNote} error={fieldErrors.note} />
        </Form>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 border-t pt-3">
        {/* ボタンの上の理由 */}
        {isUnchanged && (
          <p className="text-center text-xs text-muted-foreground">まだ何も変更していません。</p>
        )}
        {isUnlockArrangementMissing && (
          <p className="text-center text-xs text-muted-foreground">解錠の手配を選んでください。</p>
        )}

        <div className="flex w-full items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            やめる
          </Button>
          <Button type="submit" form={formId} disabled={!canConfirm} className="flex-1">
            <ClipboardCheck aria-hidden className="size-4" />
            変更内容を確認する
          </Button>
        </div>
      </CardFooter>

      <ReservationConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        formId={formId}
        isSubmitting={isSubmitting}
        title="この内容で変更しますか？"
        description={
          isDirect
            ? "変更すると、申請者と団体の管理者にお知らせのメールが届きます。"
            : "変更すると、申請者・団体の管理者・事務局にお知らせのメールが届きます。"
        }
        submitLabel="この内容で変更する"
        submittingLabel="変更中…"
      >
        {/* 何を・いつ使うのかを先に大きく出す。取り違えがいちばん困る 2 つなので */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-muted/60 p-3">
          <p className="font-medium">{facility.name}</p>
          {editPreview?.changed.has("facilityId") === true && (
            <p className="text-xs text-muted-foreground">
              変更前: {originalFacility?.name ?? "不明"}
            </p>
          )}
          <p className="tabular-nums">
            {formatMonthDay(day.date)} {draft.range === null ? "" : formatSlotRange(draft.range)}
          </p>
          {(editPreview?.changed.has("startAt") === true ||
            editPreview?.changed.has("endAt") === true) && (
            <p className="text-xs tabular-nums text-muted-foreground">
              変更前: {formatMonthDay(target.startAt)} {formatTime(target.startAt)} –{" "}
              {formatTime(target.endAt)}
            </p>
          )}
        </div>

        <dl className="flex flex-col gap-2">
          <SummaryItem label="団体">{target.groupName}</SummaryItem>
          {showUnlockArrangement && unlockArrangement !== null && (
            <SummaryItem label="解錠の手配">
              {unlockArrangementLabel[unlockArrangement]}
            </SummaryItem>
          )}
          <SummaryItem label="使用人数">
            <div className="flex flex-col">
              <span>{headCount.trim() === "" ? null : `${headCount} 名`}</span>
              {editPreview?.changed.has("headCount") === true && (
                <span className="text-xs text-muted-foreground">変更前: {target.headCount} 名</span>
              )}
            </div>
          </SummaryItem>
          <SummaryItem label="備考">
            <div className="flex flex-col">
              <span className="whitespace-pre-wrap">
                {note.trim() === "" ? "なし" : note.trim()}
              </span>
              {editPreview?.changed.has("note") === true && (
                <span className="text-xs text-muted-foreground">
                  変更前: {target.note ?? "なし"}
                </span>
              )}
            </div>
          </SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd className="flex items-center gap-2">
              <ReservationStatusBadge status={statusAfterSubmit} />
              {statusAfterSubmit !== target.status && (
                <span className="text-xs text-muted-foreground">
                  （変更前: {reservationStatusLabel[target.status]}）
                </span>
              )}
            </dd>
          </div>
        </dl>

        {needsReapproval && <ReapprovalAlert />}
        {isDirect && <DirectEditAlert />}

        {conflicts !== null && conflicts.provisionalConflicts.length > 0 && (
          <ProvisionalConflictAlert />
        )}
      </ReservationConfirmDialog>
    </>
  );
}

/**
 * 変更のとき、いまの入力が変更前から何を変えたかと、変更後に予約がどうなるかを求める。
 *
 * 判定はドメインの `changedContentFields` と `resolveEditOutcome` / `resolveDirectEditOutcome` に任せ、ここでは
 * 入力を action と同じ形（`parseReservationContent` の結果）にそろえるだけにする。
 * 画面で同じ規則を書き直すと、片方だけ直したときに、確認で見せた状態と実際の結果が食い違う。
 *
 * 時間帯を選んでいない・人数が数になっていないなど、まだ比べられないときは null を返す。
 * そのときを「何も変えていない」と扱うと、人数を消しただけで「まだ何も変更していません」と出てしまう。
 */
const toEditPreview = (
  original: ReservationEditTarget,
  facilityId: string,
  dayDate: Date,
  range: SlotRange | null,
  headCount: string,
  note: string,
  isDirect: boolean,
): {
  readonly changed: ReadonlySet<ReservationContentField>;
  readonly outcome: ReservationEditOutcome;
} | null => {
  const parsedHeadCount = Number(headCount);

  if (range === null || headCount.trim() === "" || !Number.isSafeInteger(parsedHeadCount)) {
    return null;
  }

  const trimmedNote = note.trim();
  const changed = changedContentFields(original, {
    facilityId,
    startAt: atTokyoMinutes(dayDate, range.startMinutes),
    endAt: atTokyoMinutes(dayDate, range.endMinutes),
    headCount: parsedHeadCount,
    // 備考は申請と同じく、空欄を null にそろえてから比べる（`parseReservationContent` を参照）
    note: trimmedNote === "" ? null : trimmedNote,
  });

  const outcome = isDirect
    ? resolveDirectEditOutcome(original.status, changed)
    : resolveEditOutcome(original.status, changed);

  return { changed, outcome };
};

/**
 * 承認済みの予約の施設・日時を変えると、仮予約に戻ることを伝える（COND-005）。
 *
 * フォームと確認のダイアログの両方に出すので、文言を 1 か所にまとめている。
 */
function ReapprovalAlert() {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>再承認が必要です</AlertTitle>
      <AlertDescription>
        施設または日時を変更すると、予約は仮予約に戻り、事務局による再承認が必要になります。
      </AlertDescription>
    </Alert>
  );
}

/**
 * 事務局による直接変更では再承認が不要であることを伝える。
 *
 * フォームと確認のダイアログの両方に出すので、文言を 1 か所にまとめている。
 */
function DirectEditAlert() {
  return (
    <Alert className="border-blue-500/30 bg-blue-500/5">
      <CircleAlert aria-hidden className="text-blue-600 dark:text-blue-400" />
      <AlertTitle>再承認は不要です</AlertTitle>
      <AlertDescription>
        事務局による直接変更のため、施設や日時を変更しても再承認は不要です（状態は変わりません）。
      </AlertDescription>
    </Alert>
  );
}
