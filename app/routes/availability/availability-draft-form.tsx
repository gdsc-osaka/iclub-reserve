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
import { formatSlotRange } from "~/components/reservation/editor/reservation-slots";
import {
  ProvisionalConflictAlert,
  ScheduleConflictAlerts,
} from "~/components/reservation/editor/schedule-conflict-alerts";
import { SummaryItem } from "~/components/reservation/editor/summary-item";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { UnlockArrangementField } from "~/components/reservation/unlock-arrangement-field";
import { useUnlockArrangementChoice } from "~/components/reservation/use-unlock-arrangement-choice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CardContent, CardFooter } from "~/components/ui/card";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { ReservationStatus } from "~/domain/reservation";
import { APPLICATION_DEADLINE_NOTICE, SHORT_NOTICE_ALERT } from "~/domain/reservation/lead-time";
import { unlockArrangementLabel } from "~/domain/reservation/unlock-arrangement";
import type { AppArea } from "~/lib/app-area";
import { atTokyoMinutes, formatMonthDay, toTokyoTimeKey } from "~/lib/date";
import type {
  AvailabilityFacility,
  AvailabilityReservation,
} from "~/query/facility/facility-availability-calendar";
import type { ReservationFormGroup } from "~/query/reservation/reservation-form";

import { calculateDraftSchedule } from "./draft-schedule";
import { DraftScheduleFields } from "./draft-schedule-fields";
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
  area,
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
  /** 予約を読み込んだ日（カレンダーの 4 週間と、その外で読んだ仮の枠の日）。仮の枠の日を探すのに使う */
  days: readonly AvailabilityDay[];
  reservations: readonly AvailabilityReservation[];
  now: Date;
  /** 開いている画面。欄の送り先の URL に使う */
  area: AppArea;
  canCreateDirectly: boolean;
  applicantGroups: readonly ReservationFormGroup[];
  onDraftChange: (draft: CalendarDraft) => void;
  /** 予約を作る操作の失敗。送った値・欄ごとの誤り・全体の誤り */
  createError: CreateReservationActionError | null;
  /** 確認のダイアログから送ったとき。作れたことを知らせるのに使う（欄は転送で消えるので、知らせるのは呼び出し側） */
  onSubmitCreate: () => void;
  /** スマホで欄を広げる（文字を打つ欄に入ったとき） */
  onExpand: () => void;
}>) {
  const formId = useId();
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
  // 直接作成できる人（事務局の画面）の欄は、いつも直接作成になる（ADR-016 決定 13）
  const isDirect = canCreateDirectly;
  /*
   * 直接作成で選んだ解錠の手配（COND-027）。
   * 選んだあとで施設・日時を変えたら、未選択に戻る（`useUnlockArrangementChoice`）。
   */
  const [unlockArrangement, selectUnlockArrangement] = useUnlockArrangementChoice(
    { facilityId: facility.id, dateKey: draft.dateKey, range: draft.range },
    submitted?.unlockArrangement ?? null,
  );
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // 開いている仮の枠の日は、予約を読み込んだ日の中にあることを確かめてある（toOpenSelection）
  const day = days.find((item) => item.dateKey === draft.dateKey);
  if (day === undefined) return null;

  const { blockedSlots, pastSlots, isAvailable, isStartPast, conflicts } = calculateDraftSchedule({
    draft,
    day,
    reservations,
    now,
  });

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
    onSubmitCreate();
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
          action={toCalendarPath(area, facility.id, anchorKey, { kind: "draft", draft })}
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
                予約を作成できる有効な団体がまだありません。先に団体を承認するか、有効にしてください。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 直接作成（UC-008）では解錠の手配を選ぶ（COND-027） */}
              {isDirect && (
                <>
                  <Separator />
                  <UnlockArrangementField
                    idPrefix={unlockArrangementIdPrefix}
                    value={unlockArrangement}
                    onValueChange={selectUnlockArrangement}
                    error={fieldErrors.unlockArrangement}
                  />
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

                    {/*
                     * 見出しを付けないときも、項目は `SelectGroup` で包むこと。
                     *
                     * この Select は「選んでいる項目の文字を、トリガーの値の文字に重ねる」
                     * 置き方（radix-nova の既定 `item-aligned`）で、一覧の幅はそこから
                     * 逆算される（トリガーの幅 + トリガーとの左端のずれ）。
                     * つまり端をそろえているのは幅の指定ではなく、項目の左余白。
                     * 包まないと `SelectGroup` の `p-1` が抜けて 4px 足りず、
                     * 一覧の左端だけが内側へずれる。
                     */}
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
            : "申請すると、あなたと団体の管理者、事務局にお知らせのメールが届きます。"
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
