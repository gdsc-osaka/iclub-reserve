import { CircleAlert, ClipboardCheck } from "lucide-react";
import { useId, useState } from "react";
import { Form, useNavigation } from "react-router";

import { FacilityPhoto } from "~/components/facility/facility-photo";
import { FacilityOverview } from "~/components/reservation/editor/facility-overview";
import type { FieldErrors, FormValues } from "~/components/reservation/editor/form-values";
import { PeriodSection } from "~/components/reservation/editor/period-section";
import { ReservationConfirmDialog } from "~/components/reservation/editor/reservation-confirm-dialog";
import {
  HeadCountField,
  NoteField,
} from "~/components/reservation/editor/reservation-content-fields";
import { ReservationScheduler } from "~/components/reservation/editor/reservation-scheduler";
import { formatSlotRange, type SlotRange } from "~/components/reservation/editor/reservation-slots";
import { ScheduleCard } from "~/components/reservation/editor/schedule-card";
import {
  ProvisionalConflictAlert,
  ScheduleConflictAlerts,
} from "~/components/reservation/editor/schedule-conflict-alerts";
import { SchedulePickerSheet } from "~/components/reservation/editor/schedule-picker-sheet";
import { SummaryItem } from "~/components/reservation/editor/summary-item";
import {
  useScheduleDraft,
  type ScheduleDraft,
} from "~/components/reservation/editor/use-schedule-draft";
import {
  shouldShowApplicationNotice,
  shouldShowShortNoticeAlert,
} from "~/components/reservation/editor/notice";
import {
  ReservationStatusBadge,
  reservationStatusLabel,
} from "~/components/reservation/reservation-status-badge";
import { UnlockArrangementField } from "~/components/reservation/unlock-arrangement-field";
import { useUnlockArrangementChoice } from "~/components/reservation/use-unlock-arrangement-choice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { RESERVATION_STEP_MINUTES, ReservationStatus } from "~/domain/reservation";
import { APPLICATION_DEADLINE_NOTICE, SHORT_NOTICE_ALERT } from "~/domain/reservation/lead-time";
import {
  requiresUnlockArrangementReselection,
  unlockArrangementLabel,
} from "~/domain/reservation/unlock-arrangement";
import {
  changedContentFields,
  editTargetStatus,
  resolveDirectEditOutcome,
  resolveEditOutcome,
  ReservationEditOutcome,
  type ReservationContentField,
} from "~/domain/reservation/edit";
import {
  atTokyoMinutes,
  formatMonthDay,
  formatTime,
  parseTokyoDateKey,
  parseTokyoTimeKey,
  startOfTokyoDay,
  toTokyoDateKey,
  toTokyoTimeKey,
} from "~/lib/date";
import type {
  ReservationFormFacility,
  ReservationFormReservation,
} from "~/query/reservation/reservation-form";

/** 入力欄の下に出すエラー。欄と結び付けて読み上げられるように id を振る */
function FieldError({ id, message }: Readonly<{ id: string; message: string | undefined }>) {
  if (message === undefined) return null;

  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * このフォームで変更する予約の情報。
 */
export interface ReservationEditorPurpose {
  /** 変更前の予約。初期値ではなく、何を変えたかを比べる基準として使う */
  readonly reservation: {
    readonly id: string;
    readonly groupName: string;
    readonly facilityId: string;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly headCount: number;
    readonly note: string | null;
    readonly status: ReservationStatus;
  };
  /** 事務局による直接変更か（UC-008） */
  readonly isDirect?: boolean;
}

/**
 * フォームの初期値。
 *
 * 送信して戻ってきたときは、ここではなく送った値（`actionData.values`）が優先される。
 */
export interface ReservationEditorInitial {
  readonly facilityId: string;
  readonly dateKey: string;
  readonly startMinutes: number | null;
  /** 終了時刻。分からないときは開始から 1 枠ぶんを選んでおく */
  readonly endMinutes?: number | null;
  readonly headCount?: string;
  readonly note?: string;
}

/**
 * 予約の変更フォームの本体（UC-005 / UC-008 / UC-017）。
 *
 * PC（lg 以上）では左右に分け、左で施設・日付・時間帯を、右で残りの項目を入力する。
 * スマホでは左右に分けられないので、施設・日時は写真付きのカードに要約し、
 * 押すと全画面の選択（`SchedulePickerSheet`）が開く。どちらも同じ部品を入れ物だけ変えて使う。
 *
 * ボタンはすぐには送らず、確認のダイアログを開く。最初から「この内容で変更する」が
 * 見えていると、内容を確かめないまま押されやすいため。
 *
 * 日付だけは状態に持たず、URL（＝ローダー）が持つものを唯一の正とする。
 * タイムラインに描けるのはローダーが読んだ日の予約だけなので、
 * 画面が指している日を別に持つと、日付の表示と予約の中身がずれる余地ができる。
 */
export function ReservationEditorForm({
  purpose,
  facilities,
  reservations,
  now,
  todayKey,
  initial,
  actionData,
}: Readonly<{
  purpose: ReservationEditorPurpose;
  facilities: readonly ReservationFormFacility[];
  reservations: readonly ReservationFormReservation[];
  now: Date;
  todayKey: string;
  initial: ReservationEditorInitial;
  actionData: { values: FormValues; fieldErrors: FieldErrors; formError: string | null } | null;
}>) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  /*
   * 日付を変えたあと、その日の予約を読み終えるまでの間。
   * ここで送信を止めておかないと、入力欄が新しい日付、確認欄とタイムラインが
   * 古い日付、という一瞬の食い違いのまま送信できてしまう。
   */
  const isBusy = navigation.state !== "idle";

  const formId = useId();
  const ids = {
    facilityError: useId(),
    periodError: useId(),
  };

  const fieldErrors = actionData?.fieldErrors ?? {};
  const submitted = actionData?.values ?? null;

  /** 誤りを出している要素の id。誤りが無い欄は undefined にして、読み上げに結び付けない */
  const errorIdOf = (field: keyof FieldErrors, id: string): string | undefined =>
    fieldErrors[field] === undefined ? undefined : id;

  const facilityErrorId = errorIdOf("facilityId", ids.facilityError);
  const periodErrorId = errorIdOf("period", ids.periodError);

  const draft = useScheduleDraft({
    facilities,
    reservations,
    day: parseTokyoDateKey(initial.dateKey) ?? startOfTokyoDay(now),
    now,
    initialFacilityId: submitted?.facilityId ?? initial.facilityId,
    initialRange: toInitialRange(submitted, initial.startMinutes, initial.endMinutes ?? null),
  });

  const [headCount, setHeadCount] = useState(submitted?.headCount ?? initial.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? initial.note ?? "");
  /*
   * 選んだ解錠の手配（COND-027）。承認済みの予約の施設・日時を直接変更するときに選ぶ。
   * 選んだあとで施設・日時を変えたら、未選択に戻る（`useUnlockArrangementChoice`）。
   */
  const [unlockArrangement, selectUnlockArrangement] = useUnlockArrangementChoice(
    { facilityId: draft.facility.id, dateKey: toTokyoDateKey(draft.day), range: draft.range },
    submitted?.unlockArrangement ?? null,
  );
  /** スマホの全画面の選択を開いているか */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  /** 確認ダイアログを開いているか */
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { range } = draft;

  const isDirectEdit = purpose.isDirect === true;

  /** 変更のとき、いまの入力で何が変わり、予約がどうなるか。まだ比べられないときは null */
  const editPreview = toEditPreview(purpose.reservation, draft, headCount, note, isDirectEdit);
  /** 1 項目も変えていない。送っても何も起きないので、確認へ進ませない */
  const isUnchanged = editPreview?.outcome === ReservationEditOutcome.NoChange;
  /** 承認済みの予約の施設・日時を変えたので、仮予約に戻る（COND-005。直接変更では仮予約に戻らない） */
  const needsReapproval =
    !isDirectEdit && editPreview?.outcome === ReservationEditOutcome.Reapproval;

  /** 申請の期限の目安（COND-028）の、いつも出す案内と、7 日を切ったときの注意を出すか */
  const noticeContext = {
    kind: "edit",
    isDirect: isDirectEdit,
    outcome: editPreview?.outcome ?? null,
  } as const;
  const showApplicationNotice = shouldShowApplicationNotice(noticeContext);
  const showShortNotice = shouldShowShortNoticeAlert(
    noticeContext,
    range === null ? null : atTokyoMinutes(draft.day, range.startMinutes),
    now,
  );

  /*
   * 解錠の手配（COND-027）の欄を出すか。承認済みの予約の施設・日時を直接変更するときだけ出す
   * （判定は action と同じドメインの関数）。直接作成の欄は、空き状況カレンダーの欄にある。
   * 欄を消したときは、選んでいた値も送らない（欄ごと消えるので、ラジオの値も送られない）。
   */
  const showUnlockArrangement =
    isDirectEdit &&
    editPreview !== null &&
    requiresUnlockArrangementReselection(purpose.reservation.status, editPreview.changed);
  /** 解錠の手配の欄を出しているのに、まだ選んでいない。確認へ進ませない */
  const isUnlockArrangementMissing = showUnlockArrangement && unlockArrangement === null;

  /*
   * 確認へ進めるのは、時間帯を選んでいて、承認済みの予約と重なっておらず（COND-001）、
   * 画面が次の状態へ移っている最中でなく、1 項目以上変えていて、
   * 解錠の手配の欄を出していればそれを選んでいるときだけ。
   *
   * 未選択でも止めるのは、そのすぐ上に「時間帯は未選択」と出しているため。
   * 承認済みと重なっているときも、すぐ上に理由の警告を出している。
   * 何も変えていないときと、解錠の手配を選んでいないときも、ボタンのすぐ上にそう出している。
   * 理由の見えない場所で止めているわけではない。
   */
  const canConfirm =
    range !== null &&
    draft.approvedConflicts.length === 0 &&
    !isBusy &&
    !isUnchanged &&
    !isUnlockArrangementMissing;

  /** 変更前の施設。確認のダイアログで「変更前」を添えるために使う */
  const originalFacility =
    facilities.find((item) => item.id === purpose.reservation.facilityId) ?? null;

  /*
   * 確認のダイアログに出す、送ったあとの状態。
   * 変更では、どの項目を変えたかで承認済みのままか仮予約に戻るかが決まる（COND-005）。
   */
  const statusAfterSubmit: ReservationStatus =
    editPreview === null || editPreview.outcome === ReservationEditOutcome.NoChange
      ? purpose.reservation.status
      : editTargetStatus[editPreview.outcome];

  return (
    <>
      {/*
       * 列の幅は必ず `minmax(0, ...)` で決める。既定の `auto` は中身の幅まで広がるので、
       * 中に幅の広いものを 1 つ置いた日に、スマホでページ全体が横へ流れてしまう。
       */}
      <Form
        id={formId}
        method="post"
        className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={(event) => {
          /*
           * 確認のダイアログから送られたときだけ、そのまま送る。
           *
           * それ以外（「変更内容を確認する」を押した・人数の欄で Enter を押した）は送らずに、
           * 確認のダイアログを開く。「変更内容を確認する」を送信のボタンにしているのは、
           * 必須の欄が空のままならブラウザが先に止めて、その欄を示してくれるため。
           * ダイアログを開く前に確かめる処理を自前で書かずに済む。
           */
          if (isConfirmOpen) return;

          event.preventDefault();
          if (canConfirm) setIsConfirmOpen(true);
        }}
      >
        {/*
         * 送る値。施設・日付・時刻を選ぶ欄はどれも `name` を持たず、ここの隠し欄が送る。
         * スマホではそれらの欄がフォームの外（全画面の選択）に描かれ、閉じると消えるため。
         *
         * 日付は URL の日付（＝ローダーが予約を読んだ日）をそのまま送るので、
         * 画面に出ている日と送られる日が食い違うことはない。
         */}
        <input type="hidden" name="facility_id" value={draft.facility.id} />
        <input type="hidden" name="date" value={initial.dateKey} />
        <input
          type="hidden"
          name="start_time"
          value={range === null ? "" : toTokyoTimeKey(range.startMinutes)}
        />
        <input
          type="hidden"
          name="end_time"
          value={range === null ? "" : toTokyoTimeKey(range.endMinutes)}
        />

        {actionData?.formError != null && (
          <Alert variant="destructive" className="lg:col-span-2">
            <CircleAlert aria-hidden />
            <AlertTitle>変更できませんでした</AlertTitle>
            <AlertDescription>{actionData.formError}</AlertDescription>
          </Alert>
        )}

        {/* PC の左側。スマホでは同じものを全画面の選択の中に出す */}
        <section
          aria-label="施設・日時の選択"
          className="hidden min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10 lg:block"
        >
          <ReservationScheduler
            draft={draft}
            facilities={facilities}
            dateKey={initial.dateKey}
            todayKey={todayKey}
            disabled={isBusy}
            facilityErrorId={facilityErrorId}
            periodErrorId={periodErrorId}
          />
        </section>

        {/* PC の右側。スマホではこれがフォームの全体になる */}
        <div className="flex min-w-0 flex-col gap-5 lg:rounded-xl lg:bg-card lg:p-4 lg:ring-1 lg:ring-foreground/10">
          <FacilityOverview facility={draft.facility} className="hidden lg:flex" />

          <ScheduleCard
            draft={draft}
            onOpen={() => setIsPickerOpen(true)}
            hasError={facilityErrorId !== undefined || periodErrorId !== undefined}
            describedBy={
              [facilityErrorId, periodErrorId].filter((id) => id !== undefined).join(" ") ||
              undefined
            }
            className="lg:hidden"
          />

          <FieldError id={ids.facilityError} message={fieldErrors.facilityId} />

          <PeriodSection draft={draft} errorId={periodErrorId} className="hidden lg:flex" />

          <FieldError id={ids.periodError} message={fieldErrors.period} />

          {/* 1 週間前までの申請の案内と、7 日を切ったときの注意（COND-028） */}
          {showApplicationNotice && (
            <p className="text-xs text-muted-foreground">{APPLICATION_DEADLINE_NOTICE}</p>
          )}

          {showShortNotice && (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
              <AlertDescription>{SHORT_NOTICE_ALERT}</AlertDescription>
            </Alert>
          )}

          <ScheduleConflictAlerts conflicts={draft} />

          {/* 送る前に気づけるよう、確認のダイアログを開く前から出しておく */}
          {needsReapproval && <ReapprovalAlert />}
          {isDirectEdit && <DirectEditAlert />}

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

          <div className="flex flex-col gap-2">
            <Label>団体</Label>
            {/*
             * 変更では団体を変えられないので、名前を出すだけにする。
             * group_id も送らない（`ReservationContent` を参照）。
             */}
            <p className="text-sm font-medium">{purpose.reservation.groupName}</p>
          </div>

          <HeadCountField value={headCount} onChange={setHeadCount} error={fieldErrors.headCount} />

          <NoteField value={note} onChange={setNote} error={fieldErrors.note} />

          <div className="flex flex-col gap-2">
            {/* 何も変えていない場合はボタンのすぐ近くに理由を表示する */}
            {isUnchanged && (
              <p className="text-center text-xs text-muted-foreground">
                まだ何も変更していません。
              </p>
            )}
            {isUnlockArrangementMissing && (
              <p className="text-center text-xs text-muted-foreground">
                解錠の手配を選んでください。
              </p>
            )}
            <Button type="submit" size="lg" disabled={!canConfirm} className="w-full">
              <ClipboardCheck aria-hidden />
              変更内容を確認する
            </Button>
          </div>
        </div>
      </Form>

      <SchedulePickerSheet
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        draft={draft}
        facilities={facilities}
        dateKey={initial.dateKey}
        todayKey={todayKey}
        disabled={isBusy}
        facilityErrorId={facilityErrorId}
        periodErrorId={periodErrorId}
      />

      <ReservationConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        formId={formId}
        isSubmitting={isSubmitting}
        title="この内容で変更しますか？"
        description={
          isDirectEdit
            ? "変更すると、申請者と団体の管理者にお知らせのメールが届きます。"
            : "変更すると、申請者・団体の管理者・事務局にお知らせのメールが届きます。"
        }
        submitLabel="この内容で変更する"
        submittingLabel="変更中…"
      >
        {/* 何を・いつ使うのかを先に大きく出す。取り違えがいちばん困る 2 つなので */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
          <FacilityPhoto
            photoUrl={draft.facility.photoUrl}
            alt=""
            className="aspect-[4/3] w-20 shrink-0 rounded-md"
          />

          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium">{draft.facility.name}</p>
            {editPreview?.changed.has("facilityId") === true && (
              <p className="text-xs text-muted-foreground">
                変更前: {originalFacility?.name ?? "不明"}
              </p>
            )}
            <p className="tabular-nums">
              {formatMonthDay(draft.day)} {range === null ? "" : formatSlotRange(range)}
            </p>
            {(editPreview?.changed.has("startAt") === true ||
              editPreview?.changed.has("endAt") === true) && (
              <p className="text-xs text-muted-foreground tabular-nums">
                変更前: {formatMonthDay(purpose.reservation.startAt)}{" "}
                {formatTime(purpose.reservation.startAt)} – {formatTime(purpose.reservation.endAt)}
              </p>
            )}
          </div>
        </div>

        <dl className="flex flex-col gap-2">
          <SummaryItem label="団体">{purpose.reservation.groupName}</SummaryItem>
          {showUnlockArrangement && unlockArrangement !== null && (
            <SummaryItem label="解錠の手配">
              {unlockArrangementLabel[unlockArrangement]}
            </SummaryItem>
          )}
          <SummaryItem label="使用人数">
            <div className="flex flex-col">
              <span>{headCount.trim() === "" ? null : `${headCount} 名`}</span>
              {editPreview?.changed.has("headCount") === true && (
                <span className="text-xs text-muted-foreground">
                  変更前: {purpose.reservation.headCount} 名
                </span>
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
                  変更前: {purpose.reservation.note ?? "なし"}
                </span>
              )}
            </div>
          </SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd className="flex items-center gap-2">
              <ReservationStatusBadge status={statusAfterSubmit} />
              {statusAfterSubmit !== purpose.reservation.status && (
                <span className="text-xs text-muted-foreground">
                  （変更前: {reservationStatusLabel[purpose.reservation.status]}）
                </span>
              )}
            </dd>
          </div>
        </dl>

        {needsReapproval && <ReapprovalAlert />}
        {isDirectEdit && <DirectEditAlert />}

        {draft.provisionalConflicts.length > 0 && <ProvisionalConflictAlert />}
      </ReservationConfirmDialog>
    </>
  );
}

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
        事務局による直接変更のため、施設や日時を変更しても再承認は不要です（ステータスは変わりません）。
      </AlertDescription>
    </Alert>
  );
}

/** 変更前の予約。`purpose` で受け取るもの */
type EditTarget = ReservationEditorPurpose["reservation"];

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
  original: EditTarget,
  draft: ScheduleDraft,
  headCount: string,
  note: string,
  isDirect: boolean,
): {
  readonly changed: ReadonlySet<ReservationContentField>;
  readonly outcome: ReservationEditOutcome;
} | null => {
  const { range } = draft;
  const parsedHeadCount = Number(headCount);

  if (range === null || headCount.trim() === "" || !Number.isSafeInteger(parsedHeadCount)) {
    return null;
  }

  const trimmedNote = note.trim();
  const changed = changedContentFields(original, {
    facilityId: draft.facility.id,
    startAt: atTokyoMinutes(draft.day, range.startMinutes),
    endAt: atTokyoMinutes(draft.day, range.endMinutes),
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
 * 最初に選んでおく時間帯を決める。
 *
 * 送信して戻ってきたときはその値を使う。それ以外は、変更なら予約の開始・終了を使う。
 * 終了時刻が分からないときは 1 枠ぶんだけ選んでおく。
 */
const toInitialRange = (
  submitted: FormValues | null,
  initialStartMinutes: number | null,
  initialEndMinutes: number | null,
): SlotRange | null => {
  const startMinutes = parseTokyoTimeKey(submitted?.startTime ?? null) ?? initialStartMinutes;
  if (startMinutes === null) return null;

  const endMinutes = parseTokyoTimeKey(submitted?.endTime ?? null) ?? initialEndMinutes;

  return {
    startMinutes,
    endMinutes:
      endMinutes !== null && endMinutes > startMinutes
        ? endMinutes
        : startMinutes + RESERVATION_STEP_MINUTES,
  };
};
