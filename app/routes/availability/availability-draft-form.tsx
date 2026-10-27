import { CircleAlert, ClipboardCheck } from "lucide-react";
import { useId, useState, type FocusEvent, type FormEvent } from "react";
import { Form, useNavigation } from "react-router";

import { CardItem } from "~/components/reservation/availability-detail-card";
import { toDayBlocks, type AvailabilityDay } from "~/components/reservation/availability-week";
import { DateNavigation } from "~/components/reservation/editor/date-navigation";
import type {
  FieldErrors,
  FormValues,
  ReservationFormMode,
} from "~/components/reservation/editor/form-values";
import {
  shouldShowApplicationNotice,
  shouldShowShortNoticeAlert,
} from "~/components/reservation/editor/notice";
import { OperatingHoursNotice } from "~/components/reservation/editor/operating-hours-notice";
import { ReservationConfirmDialog } from "~/components/reservation/editor/reservation-confirm-dialog";
import {
  HeadCountField,
  NoteField,
} from "~/components/reservation/editor/reservation-content-fields";
import {
  formatSlotRange,
  isRangeAvailable,
  toBlockedSlots,
  toConflicts,
  toPastSlots,
} from "~/components/reservation/editor/reservation-slots";
import {
  ProvisionalConflictAlert,
  ScheduleConflictAlerts,
} from "~/components/reservation/editor/schedule-conflict-alerts";
import { SummaryItem } from "~/components/reservation/editor/summary-item";
import { TimeRangeFields } from "~/components/reservation/editor/time-range-fields";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { UnlockArrangementField } from "~/components/reservation/unlock-arrangement-field";
import { useUnlockArrangementChoice } from "~/components/reservation/use-unlock-arrangement-choice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CardContent, CardFooter } from "~/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "~/components/ui/field";
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
import { ReservationStatus } from "~/domain/reservation";
import { APPLICATION_DEADLINE_NOTICE, SHORT_NOTICE_ALERT } from "~/domain/reservation/lead-time";
import { unlockArrangementLabel } from "~/domain/reservation/unlock-arrangement";
import { atTokyoMinutes, formatMonthDay, toTokyoDateKey, toTokyoTimeKey } from "~/lib/date";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";
import type { ReservationFormGroup } from "~/query/reservation/reservation-form";

import { toCalendarPath, type CalendarDraft } from "./paths";

/** 予約を作る操作の識別子。同じ画面の事務局の操作（承認・却下・キャンセル）と action で分ける */
export const CREATE_RESERVATION_INTENT = "create";

/**
 * 予約を作る操作が失敗したときに action が返す形。
 *
 * `intent` を付けて返すのは、画面の側で事務局の操作の失敗と見分けるため。
 * 予約を作る操作の失敗は欄の中に、事務局の操作の失敗は画面の上に出す。
 */
export interface CreateReservationActionError {
  readonly intent: typeof CREATE_RESERVATION_INTENT;
  readonly values: FormValues;
  readonly fieldErrors: FieldErrors;
  readonly formError: string | null;
}

/**
 * 空き状況カレンダーの仮の枠から、予約を申請する（事務局は直接作成もできる）欄の中身（ADR-014 決定 10・11・13）。
 *
 * 入力欄は CardContent の中でスクロールし、「内容を確認する」ボタンは CardFooter で下端に固定する。
 * 日付と時間帯は状態に持たず、URL の仮の枠（`draft`）を書き換える。カレンダーの仮の枠と同じものを指すため。
 * 団体・使用人数・備考は、この部品の中に持つ。欄は仮の枠を変えても開いたまま使い回されるので、入力は残る。
 */
export function AvailabilityDraftForm({
  draft,
  facility,
  anchorKey,
  days,
  reservations,
  now,
  canCreateDirectly,
  applicantGroups,
  onDraftChange,
  createError,
  onSubmitCreate,
  onExpand,
}: Readonly<{
  draft: CalendarDraft;
  facility: AvailabilityFacility;
  /** 基準の日（URL の `date`）。作れたあとに戻すカレンダーの基準の日になる */
  anchorKey: string;
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  canCreateDirectly: boolean;
  applicantGroups: readonly ReservationFormGroup[];
  onDraftChange: (draft: CalendarDraft) => void;
  /** 予約を作る操作の失敗。送った値・欄ごとの誤り・全体の誤り */
  createError: CreateReservationActionError | null;
  /** 確認のダイアログから送ったとき。作れたことを知らせるのに使う（欄は転送で消えるので、知らせるのは呼び出し側） */
  onSubmitCreate: (mode: ReservationFormMode) => void;
  /** スマホで欄を広げる（文字を打つ欄に入ったとき） */
  onExpand: () => void;
}>) {
  const formId = useId();
  const directSwitchId = useId();
  const periodErrorId = useId();
  const facilityErrorId = useId();
  const groupSelectId = useId();
  const groupErrorId = useId();
  const unlockArrangementIdPrefix = useId();

  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isBusy = navigation.state !== "idle";

  // 送って戻ってきたときは、送った値を初期値にする
  const submitted = createError?.values ?? null;
  const fieldErrors = createError?.fieldErrors ?? {};
  const formError = createError?.formError ?? null;

  const [groupId, setGroupId] = useState(submitted?.groupId ?? applicantGroups.at(0)?.id ?? "");
  const [headCount, setHeadCount] = useState(submitted?.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? "");
  const [isDirect, setIsDirect] = useState(canCreateDirectly && submitted?.mode === "direct");
  /*
   * 直接作成で選んだ解錠の手配（COND-027）。
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

  const dayBlocks = toDayBlocks(day, reservations);
  const blockedSlots = toBlockedSlots(dayBlocks);
  const pastSlots = toPastSlots(day.date, now);

  // カレンダーの 30 分の枠と同じ計算で、取れるかを決める
  const isAvailable =
    draft.range !== null && isRangeAvailable(draft.range, blockedSlots, pastSlots);

  // 事務局でも、有効な団体が 1 つも無ければ申請元を選べない（一般のユーザーは、そもそも欄を開けない）
  const hasNoGroups = applicantGroups.length === 0;

  /** 申請の期限の目安（COND-028）の、いつも出す案内と、7 日を切ったときの注意を出すか */
  const noticeContext = { kind: "create", isDirect } as const;
  const showApplicationNotice = shouldShowApplicationNotice(noticeContext);
  const showShortNotice = shouldShowShortNoticeAlert(
    noticeContext,
    draft.range === null ? null : atTokyoMinutes(day.date, draft.range.startMinutes),
    now,
  );

  /*
   * 解錠の手配（COND-027）は、直接作成のときだけ選ばせる。選ぶまでは確認へ進ませない。
   * 申請に切り替えたときは欄ごと消えるので、選んでいた値も送らない。
   */
  const isUnlockArrangementMissing = isDirect && unlockArrangement === null;

  /*
   * 確認へ進めるのは、時刻を選んでいて取れる時間帯で、画面が次の状態へ移っている最中でなく、
   * 直接作成なら解錠の手配を選んでいるときだけ。
   * 止めるときは、その理由（時刻を選んでいない・過ぎている・埋まっている）をボタンより上に、
   * 解錠の手配を選んでいないことをボタンのすぐ上に出している。
   */
  const canSubmit = isAvailable && !isBusy && !hasNoGroups && !isUnlockArrangementMissing;

  // 開始が過ぎているなら、重なりより先にそれを伝える（選び直すしかないので）
  const isStartPast = draft.range !== null && pastSlots.has(draft.range.startMinutes);
  // 重なりは、カレンダーの帯と同じ予約で数える
  const conflicts = draft.range === null ? null : toConflicts(dayBlocks, draft.range);

  const selectedGroup = applicantGroups.find((item) => item.id === groupId);

  /*
   * 「内容を確認する」では送らずに、確認のダイアログを開く。ダイアログから送ったときだけ、そのまま送る。
   * 「内容を確認する」を送信のボタンにしているのは、必須の欄が空のままならブラウザが先に止めて、
   * その欄を示してくれるため（変更のフォームと同じ）。
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!isConfirmOpen) {
      event.preventDefault();
      setIsConfirmOpen(true);
      return;
    }
    onSubmitCreate(isDirect ? "direct" : "provisional");
  };

  /*
   * 文字を打つ欄に入ったら、スマホでは欄を広げる（ADR-014 決定 13）。
   * キーボードが出ると、45% の高さの欄では打っている欄が隠れてしまうため。
   * 団体の選択や日付のボタンでは広げない（キーボードが出ない）。
   */
  const handleFocus = (event: FocusEvent<HTMLFormElement>) => {
    const target = event.target;
    if (
      (target instanceof HTMLInputElement && target.type !== "hidden") ||
      target instanceof HTMLTextAreaElement
    ) {
      onExpand();
    }
  };

  return (
    <>
      <CardContent className="min-h-0 flex-1 overflow-y-auto py-4">
        {/*
         * replace を付けるのは、成功の転送で仮の枠を開いていた履歴を置き換えるため（ADR-014 決定 10）。
         * 積むと、戻る操作で送り終えた仮の枠の欄がもう一度開く。
         */}
        {/*
         * 送り先は、今の URL に任せず組み立てる。任せると、サーバーとブラウザで送り先の書き方が食い違い、
         * hydration の不一致になる（開発サーバーでは、サーバーが受け取る URL の `:` が `%3A` になっていた）。
         */}
        <Form
          method="post"
          action={toCalendarPath(facility.id, anchorKey, { kind: "draft", draft })}
          replace
          id={formId}
          onSubmit={handleSubmit}
          onFocus={handleFocus}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="intent" value={CREATE_RESERVATION_INTENT} />
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
          <input type="hidden" name="mode" value={isDirect ? "direct" : "provisional"} />

          {formError !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden className="size-4" />
              <AlertTitle>申請できませんでした</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {/* 施設はカレンダーの上の切り替えで選ぶので、ここでは名前を出すだけにする */}
          <dl className="flex flex-col gap-1 text-sm">
            <CardItem label="施設・設備">{facility.name}</CardItem>
          </dl>

          {/*
           * 日付を変えたら、時間帯はそのままで仮の枠の日を移す。4 週間の外の日なら、
           * その日を基準の日にして読み直す（ADR-014 決定 11。`openDraft` が決める）
           */}
          <DateNavigation
            day={day.date}
            dateKey={draft.dateKey}
            todayKey={toTokyoDateKey(now)}
            disabled={isBusy}
            errorId={fieldErrors.period ? periodErrorId : undefined}
            onSelectDate={(nextDateKey) =>
              onDraftChange({ dateKey: nextDateKey, range: draft.range })
            }
          />

          <div className="flex flex-col gap-1.5">
            <TimeRangeFields
              range={draft.range}
              // 欄は SetStateAction を渡してくるので、今の時間帯に当ててから仮の枠を書き換える
              onChange={(update) => {
                const nextRange = typeof update === "function" ? update(draft.range) : update;
                onDraftChange({ dateKey: draft.dateKey, range: nextRange });
              }}
              blockedSlots={blockedSlots}
              pastSlots={pastSlots}
              errorId={fieldErrors.period ? periodErrorId : undefined}
            />

            <OperatingHoursNotice />

            {draft.range === null && (
              <p className="text-xs text-muted-foreground">
                カレンダーの空いている時間を押すか、開始時刻と終了時刻を選んでください。
              </p>
            )}
          </div>

          <FieldError id={periodErrorId}>{fieldErrors.period}</FieldError>
          <FieldError id={facilityErrorId}>{fieldErrors.facilityId}</FieldError>

          {/* 1 週間前までの申請の案内（COND-028） */}
          {showApplicationNotice && (
            <p className="text-xs text-muted-foreground">{APPLICATION_DEADLINE_NOTICE}</p>
          )}

          {isStartPast ? (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
              <AlertDescription>
                過ぎた日時からは申請できません。日時を選び直してください。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 7 日を切ったときの注意（COND-028）。過ぎているときは選び直すしかないので出さない */}
              {showShortNotice && (
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
                  <AlertDescription>{SHORT_NOTICE_ALERT}</AlertDescription>
                </Alert>
              )}
              {conflicts !== null && <ScheduleConflictAlerts conflicts={conflicts} />}
            </>
          )}

          {hasNoGroups ? (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
              <AlertDescription>
                申請元にできる有効な団体がまだ 1
                つもありません。団体を有効にしてから申請してください。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 直接作成の切り替えは事務局だけ（UC-008） */}
              {canCreateDirectly && (
                <>
                  <Separator />
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor={directSwitchId}>承認済みとして直接作成する</FieldLabel>
                      <FieldDescription>
                        仮予約を経ずに最初から承認済みとして登録します（事務局専用）。
                      </FieldDescription>
                    </FieldContent>
                    <Switch id={directSwitchId} checked={isDirect} onCheckedChange={setIsDirect} />
                  </Field>

                  {isDirect && (
                    <UnlockArrangementField
                      idPrefix={unlockArrangementIdPrefix}
                      value={unlockArrangement}
                      onValueChange={selectUnlockArrangement}
                      error={fieldErrors.unlockArrangement}
                    />
                  )}
                </>
              )}

              <Field data-invalid={fieldErrors.groupId !== undefined}>
                <FieldLabel htmlFor={groupSelectId}>申請元の団体</FieldLabel>

                {applicantGroups.length === 1 ? (
                  /* 選べる団体が 1 つしかないなら、選ばせる意味がないので表示だけにする */
                  <>
                    <p id={groupSelectId} className="text-sm font-medium">
                      {applicantGroups[0].name}
                    </p>
                    <input type="hidden" name="group_id" value={applicantGroups[0].id} />
                  </>
                ) : (
                  // `name` は Select に付ける。Select が送信用の隠れた select を描き、選んだ値を送る
                  <Select name="group_id" required value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger
                      id={groupSelectId}
                      className="w-full"
                      aria-invalid={fieldErrors.groupId !== undefined}
                      aria-describedby={
                        fieldErrors.groupId === undefined ? undefined : groupErrorId
                      }
                    >
                      <SelectValue placeholder="選んでください" />
                    </SelectTrigger>

                    {/* 項目を `SelectGroup` で包む理由は `ReservationScheduler` の施設の欄を参照 */}
                    <SelectContent>
                      <SelectGroup>
                        {applicantGroups.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}

                <FieldError id={groupErrorId}>{fieldErrors.groupId}</FieldError>
              </Field>

              <HeadCountField
                value={headCount}
                onChange={setHeadCount}
                error={fieldErrors.headCount}
              />

              <NoteField value={note} onChange={setNote} error={fieldErrors.note} />
            </>
          )}
        </Form>
      </CardContent>

      {/* 欄の中を送っても動かないよう、ボタンは中身の外の下端に置き、`form` 属性でフォームを指す */}
      {!hasNoGroups && (
        <CardFooter className="shrink-0 flex-col gap-2 border-t p-4">
          {isUnlockArrangementMissing && (
            <p className="text-center text-xs text-muted-foreground">
              解錠の手配を選んでください。
            </p>
          )}
          <Button type="submit" form={formId} disabled={!canSubmit} className="w-full">
            <ClipboardCheck aria-hidden />
            内容を確認する
          </Button>
        </CardFooter>
      )}

      <ReservationConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        formId={formId}
        isSubmitting={isSubmitting}
        title={isDirect ? "予約の直接作成" : "この内容で申請しますか？"}
        description={
          isDirect
            ? "仮予約を経ずに最初から承認済みとして作成されます。メールは送信されません。"
            : "申請すると仮予約として登録され、あなたと団体の管理者、事務局にお知らせのメールが届きます。施設・設備を利用できるのは、事務局が承認してからです。"
        }
        submitLabel={isDirect ? "承認済みで作成する" : "この内容で申請する"}
        submittingLabel={isDirect ? "作成中…" : "申請中…"}
      >
        {/*
         * 何を・いつ使うのかを先に大きく出す。取り違えがいちばん困る 2 つなので。
         * 施設の写真は出さない（空き状況の読み取りは写真を持っていない）。
         */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-muted/60 p-3">
          <p className="font-medium">{facility.name}</p>
          <p className="tabular-nums">
            {formatMonthDay(day.date)} {draft.range === null ? "" : formatSlotRange(draft.range)}
          </p>
        </div>

        <dl className="flex flex-col gap-2">
          <SummaryItem label="団体">{selectedGroup?.name ?? null}</SummaryItem>
          {isDirect && unlockArrangement !== null && (
            <SummaryItem label="解錠の手配">
              {unlockArrangementLabel[unlockArrangement]}
            </SummaryItem>
          )}
          <SummaryItem label="使用人数">
            {headCount.trim() === "" ? null : `${headCount} 名`}
          </SummaryItem>
          <SummaryItem label="備考">
            <span className="whitespace-pre-wrap">{note.trim() === "" ? "なし" : note.trim()}</span>
          </SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd className="flex items-center gap-2">
              <ReservationStatusBadge
                status={isDirect ? ReservationStatus.Approved : ReservationStatus.Provisional}
              />
            </dd>
          </div>
        </dl>

        {conflicts !== null && conflicts.provisionalConflicts.length > 0 && (
          <ProvisionalConflictAlert />
        )}
      </ReservationConfirmDialog>
    </>
  );
}
