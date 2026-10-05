import { CircleAlert, ClipboardCheck } from "lucide-react";
import { useId, useState } from "react";
import { Form, useNavigation } from "react-router";

import { FacilityPhoto } from "~/components/facility/facility-photo";
import { FacilityOverview } from "~/components/reservation/editor/facility-overview";
import type {
  FieldErrors,
  FormValues,
  ReservationFormMode,
} from "~/components/reservation/editor/form-values";
import { PeriodSection } from "~/components/reservation/editor/period-section";
import { ReservationConfirmDialog } from "~/components/reservation/editor/reservation-confirm-dialog";
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
  ReservationStatusBadge,
  reservationStatusLabel,
} from "~/components/reservation/reservation-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  RESERVATION_STEP_MINUTES,
  ReservationStatus,
} from "~/domain/reservation";
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
  toTokyoTimeKey,
} from "~/lib/date";
import type {
  ReservationFormFacility,
  ReservationFormGroup,
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
 * このフォームで何をするか。仮予約の申請・直接作成（create）か、予約の内容の変更（edit）か。
 *
 * 申請と変更の違いはこの prop 1 つだけで受け取る。日時の選択・人数・備考・確認のダイアログの流れは
 * どちらも同じものを使い、違うところ（団体の欄・文言・確認で見せる状態）だけを `kind` で分ける。
 * prop を別々に増やすと、「変更なのに直接作成のスイッチが出る」といった組み合わせを作れてしまう。
 */
export type ReservationEditorPurpose =
  | {
      readonly kind: "create";
      /** 申請元として選べる有効な団体 */
      readonly groups: readonly ReservationFormGroup[];
      /** 承認済みで直接作成できるか（事務局のみ） */
      readonly canCreateDirectly?: boolean;
    }
  | {
      readonly kind: "edit";
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
    };

/**
 * フォームの初期値。どちらのルートも同じ形で渡す。
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
  /** 申請のときだけ使う。直接作成のスイッチを最初からオンにするか */
  readonly mode?: ReservationFormMode;
}

/**
 * 予約の申請・変更フォームの本体（SCR-002 / UC-002 / UC-008、UC-005 / UC-017）。
 *
 * 申請（`/reservations/new`）と変更（`/reservations/:reservationId/edit`）で共有する。
 *
 * PC（lg 以上）では左右に分け、左で施設・日付・時間帯を、右で残りの項目を入力する。
 * スマホでは左右に分けられないので、施設・日時は写真付きのカードに要約し、
 * 押すと全画面の選択（`SchedulePickerSheet`）が開く。どちらも同じ部品を入れ物だけ変えて使う。
 *
 * ボタンはすぐには送らず、確認のダイアログを開く。最初から「この内容で申請する」が
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
    groupError: useId(),
    facilityError: useId(),
    periodError: useId(),
    headCountError: useId(),
    noteError: useId(),
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

  /*
   * 団体を選ぶのは申請のときだけ。変更では団体を変えられないので
   * （`ReservationContent` を参照）、この状態は使わない。
   */
  const [groupId, setGroupId] = useState(
    submitted?.groupId ?? (purpose.kind === "create" ? (purpose.groups.at(0)?.id ?? "") : ""),
  );
  const [headCount, setHeadCount] = useState(submitted?.headCount ?? initial.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? initial.note ?? "");
  /** 承認済みとして直接作成するか（事務局の申請のときだけ操作できる。変更では出さない） */
  const [isDirect, setIsDirect] = useState(
    purpose.kind === "create" &&
      purpose.canCreateDirectly === true &&
      (submitted?.mode ?? initial.mode) === "direct",
  );
  /** スマホの全画面の選択を開いているか */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  /** 確認ダイアログを開いているか */
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const group =
    purpose.kind === "create" ? (purpose.groups.find((item) => item.id === groupId) ?? null) : null;
  const { range } = draft;

  const isDirectEdit = purpose.kind === "edit" && purpose.isDirect === true;

  /** 変更のとき、いまの入力で何が変わり、予約がどうなるか。申請のときと、まだ比べられないときは null */
  const editPreview =
    purpose.kind === "edit"
      ? toEditPreview(purpose.reservation, draft, headCount, note, isDirectEdit)
      : null;
  /** 1 項目も変えていない。送っても何も起きないので、確認へ進ませない */
  const isUnchanged = editPreview?.outcome === ReservationEditOutcome.NoChange;
  /** 承認済みの予約の施設・日時を変えたので、仮予約に戻る（COND-005。直接変更では仮予約に戻らない） */
  const needsReapproval =
    !isDirectEdit && editPreview?.outcome === ReservationEditOutcome.Reapproval;

  /*
   * 確認へ進めるのは、時間帯を選んでいて、承認済みの予約と重なっておらず（COND-001）、
   * 画面が次の状態へ移っている最中でなく、変更なら 1 項目以上変えているときだけ。
   *
   * 未選択でも止めるのは、そのすぐ上に「時間帯は未選択」と出しているため。
   * 承認済みと重なっているときも、すぐ上に理由の警告を出している。
   * 何も変えていないときも、ボタンのすぐ上にそう出している。
   * 理由の見えない場所で止めているわけではない。
   */
  const canConfirm =
    range !== null && draft.approvedConflicts.length === 0 && !isBusy && !isUnchanged;

  /** 変更前の施設。確認のダイアログで「変更前」を添えるために使う */
  const originalFacility =
    purpose.kind === "edit"
      ? (facilities.find((item) => item.id === purpose.reservation.facilityId) ?? null)
      : null;

  /*
   * 確認のダイアログに出す、送ったあとの状態。
   * 変更では、どの項目を変えたかで承認済みのままか仮予約に戻るかが決まる（COND-005）。
   */
  const statusAfterSubmit: ReservationStatus =
    purpose.kind === "create"
      ? isDirect
        ? ReservationStatus.Approved
        : ReservationStatus.Provisional
      : editPreview === null || editPreview.outcome === ReservationEditOutcome.NoChange
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
           * それ以外（「内容を確認する」を押した・人数の欄で Enter を押した）は送らずに、
           * 確認のダイアログを開く。「内容を確認する」を送信のボタンにしているのは、
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
        {/* 変更画面では mode（直接作成）は存在しないため、申請時のみ送る */}
        {purpose.kind === "create" && (
          <input type="hidden" name="mode" value={isDirect ? "direct" : "provisional"} />
        )}

        {actionData?.formError != null && (
          <Alert variant="destructive" className="lg:col-span-2">
            <CircleAlert aria-hidden />
            <AlertTitle>
              {purpose.kind === "edit" ? "変更できませんでした" : "申請できませんでした"}
            </AlertTitle>
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

          <ScheduleConflictAlerts draft={draft} />

          {/* 送る前に気づけるよう、確認のダイアログを開く前から出しておく */}
          {needsReapproval && <ReapprovalAlert />}
          {isDirectEdit && <DirectEditAlert />}

          {purpose.kind === "create" && purpose.canCreateDirectly === true && (
            <>
              <Separator />

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="direct-mode-switch" className="text-sm font-medium">
                    承認済みとして直接作成する
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    仮予約を経ずに最初から承認済みとして登録します（事務局専用）。
                  </p>
                </div>
                <Switch id="direct-mode-switch" checked={isDirect} onCheckedChange={setIsDirect} />
              </div>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="group_id">{purpose.kind === "edit" ? "団体" : "申請元の団体"}</Label>

            {purpose.kind === "edit" ? (
              /*
               * 変更では団体を変えられないので、名前を出すだけにする。
               * group_id も送らない（`ReservationContent` を参照）。
               */
              <p className="text-sm font-medium">{purpose.reservation.groupName}</p>
            ) : purpose.groups.length === 1 ? (
              /* 選べる団体が 1 つしかないなら、選ばせる意味がないので表示だけにする */
              <>
                <p className="text-sm font-medium">{purpose.groups[0].name}</p>
                <input type="hidden" name="group_id" value={purpose.groups[0].id} />
              </>
            ) : (
              <Select name="group_id" required value={groupId} onValueChange={setGroupId}>
                <SelectTrigger
                  id="group_id"
                  className="w-full"
                  aria-invalid={fieldErrors.groupId !== undefined}
                  aria-describedby={errorIdOf("groupId", ids.groupError)}
                >
                  <SelectValue placeholder="選んでください" />
                </SelectTrigger>

                {/* 項目を `SelectGroup` で包む理由は `ReservationScheduler` の施設の欄を参照 */}
                <SelectContent>
                  <SelectGroup>
                    {purpose.groups.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}

            <FieldError id={ids.groupError} message={fieldErrors.groupId} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="head_count">使用人数</Label>

            {/* 単位を添えて、数だけを入れればよいことを見せる。確認・控えの「4 名」と同じ単位にする */}
            <div className="flex items-center gap-2">
              <Input
                id="head_count"
                name="head_count"
                type="number"
                inputMode="numeric"
                required
                min={RESERVATION_MIN_HEAD_COUNT}
                value={headCount}
                onChange={(event) => setHeadCount(event.target.value)}
                aria-invalid={fieldErrors.headCount !== undefined}
                aria-describedby={errorIdOf("headCount", ids.headCountError)}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">名</span>
            </div>

            <FieldError id={ids.headCountError} message={fieldErrors.headCount} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="note">
                備考 <span className="font-normal text-muted-foreground">（任意）</span>
              </Label>

              <span className="text-xs text-muted-foreground tabular-nums">
                {note.length} / {RESERVATION_NOTE_MAX_LENGTH}
              </span>
            </div>

            <Textarea
              id="note"
              name="note"
              rows={3}
              maxLength={RESERVATION_NOTE_MAX_LENGTH}
              placeholder="利用目的や、事務局に伝えておきたいことがあれば書いてください。"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={fieldErrors.note !== undefined}
              aria-describedby={errorIdOf("note", ids.noteError)}
            />

            <p className="text-xs text-muted-foreground">
              使用人数と備考は、申請した団体のメンバーと事務局にだけ公開されます。
            </p>

            <FieldError id={ids.noteError} message={fieldErrors.note} />
          </div>

          <div className="flex flex-col gap-2">
            {/* 何も変えていない場合はボタンのすぐ近くに理由を表示する */}
            {isUnchanged && (
              <p className="text-center text-xs text-muted-foreground">
                まだ何も変更していません。
              </p>
            )}
            <Button type="submit" size="lg" disabled={!canConfirm} className="w-full">
              <ClipboardCheck aria-hidden />
              {purpose.kind === "edit" ? "変更内容を確認する" : "内容を確認する"}
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
        title={
          purpose.kind === "edit"
            ? "この内容で変更しますか？"
            : isDirect
              ? "予約の直接作成"
              : "この内容で申請しますか？"
        }
        description={
          purpose.kind === "edit"
            ? isDirectEdit
              ? "変更すると、申請者と団体の管理者にお知らせのメールが届きます。"
              : "変更すると、申請者・団体の管理者・事務局にお知らせのメールが届きます。"
            : isDirect
              ? "仮予約を経ずに最初から承認済みとして作成されます。メールは送信されません。"
              : "申請すると仮予約として登録され、あなたと団体の管理者、事務局にお知らせのメールが届きます。施設・設備を利用できるのは、事務局が承認してからです。"
        }
        submitLabel={
          purpose.kind === "edit"
            ? "この内容で変更する"
            : isDirect
              ? "承認済みで作成する"
              : "この内容で申請する"
        }
        submittingLabel={purpose.kind === "edit" ? "変更中…" : isDirect ? "作成中…" : "申請中…"}
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
            {purpose.kind === "edit" &&
              (editPreview?.changed.has("startAt") === true ||
                editPreview?.changed.has("endAt") === true) && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  変更前: {formatMonthDay(purpose.reservation.startAt)}{" "}
                  {formatTime(purpose.reservation.startAt)} –{" "}
                  {formatTime(purpose.reservation.endAt)}
                </p>
              )}
          </div>
        </div>

        <dl className="flex flex-col gap-2">
          <SummaryItem label="団体">
            {purpose.kind === "edit" ? purpose.reservation.groupName : (group?.name ?? null)}
          </SummaryItem>
          <SummaryItem label="使用人数">
            <div className="flex flex-col">
              <span>{headCount.trim() === "" ? null : `${headCount} 名`}</span>
              {purpose.kind === "edit" && editPreview?.changed.has("headCount") === true && (
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
              {purpose.kind === "edit" && editPreview?.changed.has("note") === true && (
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
              {purpose.kind === "edit" && statusAfterSubmit !== purpose.reservation.status && (
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

/** 変更前の予約。変更（edit）のときに `purpose` で受け取るもの */
type EditTarget = Extract<ReservationEditorPurpose, { kind: "edit" }>["reservation"];

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
 * 送信して戻ってきたときはその値を使う。それ以外は、変更なら予約の開始・終了、
 * 空き状況カレンダーから来た申請なら押した枠の開始時刻を使う。
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
