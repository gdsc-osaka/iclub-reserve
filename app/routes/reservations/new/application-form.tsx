import { CircleAlert, ClipboardCheck } from "lucide-react";
import { useId, useState } from "react";
import { Form, useNavigation } from "react-router";

import { FacilityPhoto } from "~/components/facility/facility-photo";
import { FacilityOverview } from "~/components/reservation/editor/facility-overview";
import type { FieldErrors, FormValues } from "~/components/reservation/editor/form-values";
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
import { useScheduleDraft } from "~/components/reservation/editor/use-schedule-draft";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
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
import { Textarea } from "~/components/ui/textarea";
import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  RESERVATION_STEP_MINUTES,
  ReservationStatus,
} from "~/domain/reservation";
import {
  formatMonthDay,
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
 * 申請フォームの本体。
 *
 * PC（lg 以上）では左右に分け、左で施設・日付・時間帯を、右で残りの項目を入力する。
 * スマホでは左右に分けられないので、施設・日時は写真付きのカードに要約し、
 * 押すと全画面の選択（`SchedulePickerSheet`）が開く。どちらも同じ部品を入れ物だけ変えて使う。
 *
 * 申請のボタンはすぐには送らず、確認のダイアログを開く。最初から「この内容で申請する」が
 * 見えていると、内容を確かめないまま押されやすいため。
 *
 * 日付だけは状態に持たず、URL（＝ローダー）が持つものを唯一の正とする。
 * タイムラインに描けるのはローダーが読んだ日の予約だけなので、
 * 画面が指している日を別に持つと、日付の表示と予約の中身がずれる余地ができる。
 */
export function ApplicationForm({
  groups,
  facilities,
  reservations,
  now,
  todayKey,
  initial,
  actionData,
}: Readonly<{
  groups: readonly ReservationFormGroup[];
  facilities: readonly ReservationFormFacility[];
  reservations: readonly ReservationFormReservation[];
  now: Date;
  todayKey: string;
  initial: { facilityId: string; dateKey: string; startMinutes: number | null };
  actionData: { values: FormValues; fieldErrors: FieldErrors; formError: string | null } | null;
}>) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  /*
   * 日付を変えたあと、その日の予約を読み終えるまでの間。
   * ここで申請を止めておかないと、入力欄が新しい日付、確認欄とタイムラインが
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
    initialRange: toInitialRange(submitted, initial.startMinutes),
  });

  const [groupId, setGroupId] = useState(submitted?.groupId ?? groups.at(0)?.id ?? "");
  const [headCount, setHeadCount] = useState(submitted?.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? "");
  /** スマホの全画面の選択を開いているか */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  /** 申請内容の確認ダイアログを開いているか */
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const group = groups.find((item) => item.id === groupId) ?? null;
  const { range } = draft;

  /*
   * 確認へ進めるのは、時間帯を選んでいて、承認済みの予約と重なっておらず（COND-001）、
   * 画面が次の状態へ移っている最中でないときだけ。
   *
   * 未選択でも止めるのは、そのすぐ上に「時間帯は未選択」と出しているため。
   * 承認済みと重なっているときも、すぐ上に理由の警告を出している。
   * 理由の見えない場所で止めているわけではない。
   */
  const canConfirm = range !== null && draft.approvedConflicts.length === 0 && !isBusy;

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

        {actionData?.formError != null && (
          <Alert variant="destructive" className="lg:col-span-2">
            <CircleAlert aria-hidden />
            <AlertTitle>申請できませんでした</AlertTitle>
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

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="group_id">申請元の団体</Label>

            {groups.length === 1 ? (
              /* 選べる団体が 1 つしかないなら、選ばせる意味がないので表示だけにする */
              <>
                <p className="text-sm font-medium">{groups[0].name}</p>
                <input type="hidden" name="group_id" value={groups[0].id} />
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
                    {groups.map((item) => (
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
              className="sm:max-w-40"
            />

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
              placeholder="使い方や、事務局に伝えておきたいことがあれば書いてください。"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={fieldErrors.note !== undefined}
              aria-describedby={errorIdOf("note", ids.noteError)}
            />

            <p className="text-xs text-muted-foreground">
              使用人数と備考は、申請した団体のメンバーと事務局だけが見られます。
            </p>

            <FieldError id={ids.noteError} message={fieldErrors.note} />
          </div>

          <Button type="submit" size="lg" disabled={!canConfirm} className="w-full">
            <ClipboardCheck aria-hidden />
            内容を確認する
          </Button>
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
        title="この内容で申請しますか？"
        description="申請すると仮予約として登録され、団体の管理者と事務局に通知が届きます。実際に使えるようになるのは、事務局が承認したあとです。"
        submitLabel="この内容で申請する"
        submittingLabel="申請中…"
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
            <p className="tabular-nums">
              {formatMonthDay(draft.day)} {range === null ? "" : formatSlotRange(range)}
            </p>
          </div>
        </div>

        <dl className="flex flex-col gap-2">
          <SummaryItem label="団体">{group?.name ?? null}</SummaryItem>
          <SummaryItem label="使用人数">
            {headCount.trim() === "" ? null : `${headCount} 名`}
          </SummaryItem>
          <SummaryItem label="備考">{note.trim() === "" ? "なし" : note.trim()}</SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        {draft.provisionalConflicts.length > 0 && <ProvisionalConflictAlert />}
      </ReservationConfirmDialog>
    </>
  );
}

/**
 * 最初に選んでおく時間帯を決める。
 *
 * 送信して戻ってきたときはその値を、空き状況カレンダーから来たときは
 * 押した枠の開始時刻を使う。終了時刻が分からないときは 1 枠ぶんだけ選んでおく。
 */
const toInitialRange = (
  submitted: FormValues | null,
  initialStartMinutes: number | null,
): SlotRange | null => {
  const startMinutes = parseTokyoTimeKey(submitted?.startTime ?? null) ?? initialStartMinutes;
  if (startMinutes === null) return null;

  const endMinutes = parseTokyoTimeKey(submitted?.endTime ?? null);

  return {
    startMinutes,
    endMinutes:
      endMinutes !== null && endMinutes > startMinutes
        ? endMinutes
        : startMinutes + RESERVATION_STEP_MINUTES,
  };
};
