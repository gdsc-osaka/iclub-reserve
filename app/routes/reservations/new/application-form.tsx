import { CircleAlert } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  RESERVATION_STEP_MINUTES,
  ReservationStatus,
} from "~/domain/reservation";
import { useFieldErrors } from "~/hooks/use-field-errors";
import { formatTimeRange, parseTokyoDateKey, parseTokyoTimeKey, startOfTokyoDay } from "~/lib/date";
import type {
  ReservationFormFacility,
  ReservationFormGroup,
  ReservationFormReservation,
} from "~/query/reservation/reservation-form";

import { DateField } from "./date-field";
import type { FieldErrors, FormValues } from "./form-values";
import {
  findOverlapping,
  selectSlot,
  toBlockedSlots,
  toPastSlots,
  toTimelineReservations,
  type SlotRange,
} from "./reservation-slots";
import { ReservationTimeline, ReservationTimelineLegend } from "./reservation-timeline";
import { SummaryPanel } from "./summary-panel";
import { TimeRangeFields } from "./time-range-fields";

/** 入力欄をまとめた小さな枠。見出しと本体の間隔をそろえるために使う */
function FormSection({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: ReactNode }>) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

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
 * 入力の値はすべて React の状態で持ち、右側の確認欄に同じ値を映している。
 * 申請してから「思っていた内容と違う」と気づく余地を減らすため。
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

  /*
   * 申請して戻ってきた欄ごとのエラーは、その欄を打ち直した時点で消す。
   *
   * 残すと、直し終えた欄の `aria-invalid` が true のままになり、読み上げは直した欄を
   * 「不正な入力」と言い続ける（詳しくは `useFieldErrors` の説明を参照）。
   *
   * SCR-006・SCR-007 のフォームと同じ考え方で動かすため、判定はフックに寄せている。
   */
  const { fieldError, markEdited, resetEdited } = useFieldErrors(actionData?.fieldErrors);
  /** いま出してよい、欄ごとのエラー。打ち直された欄のぶんは入らない */
  const fieldErrors = {
    groupId: fieldError("groupId"),
    facilityId: fieldError("facilityId"),
    period: fieldError("period"),
    headCount: fieldError("headCount"),
    note: fieldError("note"),
  };

  const submitted = actionData?.values ?? null;

  const [groupId, setGroupId] = useState(submitted?.groupId ?? groups.at(0)?.id ?? "");
  const [facilityId, setFacilityId] = useState(
    submitted?.facilityId ??
      (initial.facilityId === "" ? (facilities.at(0)?.id ?? "") : initial.facilityId),
  );
  const [headCount, setHeadCount] = useState(submitted?.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? "");
  const [range, setRange] = useState<SlotRange | null>(() =>
    toInitialRange(submitted, initial.startMinutes),
  );

  /*
   * 値を変える口はここにまとめ、変えると同時にその欄を「打ち直した」印を付ける。
   * 入力の変化はどれもこの 5 つを通るので、印の付け忘れが起きない。
   *
   * 時間帯だけ触れる口が 3 つ（タイムラインの選択・ドラッグ・時刻の欄）あるが、
   * 日付・開始・終了は 3 つで 1 つの `period` なので、どこを触っても同じ印を付ける。
   */
  const changeGroupId = (value: string) => {
    setGroupId(value);
    markEdited("groupId");
  };
  const changeFacilityId = (value: string) => {
    setFacilityId(value);
    markEdited("facilityId");
  };
  const changeHeadCount = (value: string) => {
    setHeadCount(value);
    markEdited("headCount");
  };
  const changeNote = (value: string) => {
    setNote(value);
    markEdited("note");
  };
  const changeRange: Dispatch<SetStateAction<SlotRange | null>> = (next) => {
    setRange(next);
    markEdited("period");
  };

  const day = parseTokyoDateKey(initial.dateKey) ?? startOfTokyoDay(now);
  const facility = facilities.find((item) => item.id === facilityId) ?? facilities[0];
  const group = groups.find((item) => item.id === groupId) ?? null;

  const items = toTimelineReservations(reservations, facilityId, day);
  const blockedSlots = toBlockedSlots(items);
  const pastSlots = toPastSlots(day, now);

  const overlapping = range === null ? [] : findOverlapping(items, range);
  const approvedConflicts = overlapping.filter(
    (item) => item.reservation.status === ReservationStatus.Approved,
  );
  const provisionalConflicts = overlapping.filter(
    (item) => item.reservation.status === ReservationStatus.Provisional,
  );

  /*
   * 送信を止めるのは、時間帯が未選択のとき、承認済みの予約と重なっているとき
   * （COND-001）、そして画面が次の状態へ移っている最中だけ。
   *
   * 未選択でも止めるのは、そのすぐ上の確認欄に「時間 未入力」と出しているため。
   * 理由の見えない場所で止めているわけではない。
   */
  const canSubmit = range !== null && approvedConflicts.length === 0 && !isBusy;

  return (
    /*
     * 列の幅は必ず `minmax(0, ...)` で決める。既定の `auto` は中身の幅まで広がるので、
     * 中に幅の広いものを 1 つ置いた日に、スマホでページ全体が横へ流れてしまう。
     */
    <Form
      method="post"
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
      /* 送信のたびに打ち直しの印を消す。いま送った値に対する新しいエラーは出したいため */
      onSubmit={resetEdited}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {actionData?.formError != null && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>申請できませんでした</AlertTitle>
            <AlertDescription>{actionData.formError}</AlertDescription>
          </Alert>
        )}

        <FormSection title="利用者・施設">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group_id">申請元の団体</Label>

            {groups.length === 1 ? (
              /* 選べる団体が 1 つしかないなら、選ばせる意味がないので表示だけにする */
              <>
                <p className="text-sm font-medium">{groups[0].name}</p>
                <input type="hidden" name="group_id" value={groups[0].id} />
              </>
            ) : (
              <Select name="group_id" required value={groupId} onValueChange={changeGroupId}>
                <SelectTrigger
                  id="group_id"
                  className="w-full"
                  aria-invalid={fieldErrors.groupId !== undefined}
                  aria-describedby={
                    fieldErrors.groupId !== undefined ? "group_id-error" : undefined
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
                    {groups.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}

            <FieldError id="group_id-error" message={fieldErrors.groupId} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="facility_id">施設・設備</Label>

            {/*
             * 施設を変えてもサーバーへは取りに行かない。ローダーはその日の予約を
             * 施設で絞らずに読んでいるので、必要なぶんはもう手元にある。
             */}
            <Select name="facility_id" required value={facilityId} onValueChange={changeFacilityId}>
              <SelectTrigger
                id="facility_id"
                className="w-full"
                aria-invalid={fieldErrors.facilityId !== undefined}
                aria-describedby={
                  fieldErrors.facilityId !== undefined ? "facility_id-error" : undefined
                }
              >
                <SelectValue placeholder="選んでください" />
              </SelectTrigger>

              <SelectContent>
                <SelectGroup>
                  {facilities.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {facility?.description != null && (
              <p className="text-sm text-muted-foreground">{facility.description}</p>
            )}

            <FieldError id="facility_id-error" message={fieldErrors.facilityId} />
          </div>
        </FormSection>

        <FormSection
          title="利用日時"
          description={`利用できるのは ${FACILITY_OPEN_HOUR}:00〜${FACILITY_CLOSE_HOUR}:00 です。日をまたぐ予約はできません。`}
        >
          <DateField
            day={day}
            dateKey={initial.dateKey}
            todayKey={todayKey}
            facilityId={facilityId}
            hasError={fieldErrors.period !== undefined}
          />

          <ReservationTimeline
            day={day}
            now={now}
            items={items}
            blockedSlots={blockedSlots}
            pastSlots={pastSlots}
            range={range}
            disabled={isBusy}
            onSelectSlot={(slot) =>
              changeRange((current) => selectSlot(current, slot, blockedSlots))
            }
            onSelectRange={changeRange}
          />

          <ReservationTimelineLegend />

          <TimeRangeFields
            range={range}
            onChange={changeRange}
            blockedSlots={blockedSlots}
            pastSlots={pastSlots}
            hasError={fieldErrors.period !== undefined}
          />

          <FieldError id="period-error" message={fieldErrors.period} />

          {approvedConflicts.length > 0 && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>この時間帯はすでに埋まっています</AlertTitle>
              <AlertDescription>
                {approvedConflicts
                  .map(
                    (item) =>
                      `${formatTimeRange(item.reservation.startAt, item.reservation.endAt)}（${item.reservation.groupName}）`,
                  )
                  .join("、")}
                が承認済みです。重ねて申請することはできません（COND-001）。
              </AlertDescription>
            </Alert>
          )}

          {approvedConflicts.length === 0 && provisionalConflicts.length > 0 && (
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
              <AlertTitle>同じ時間帯に、他の申請があります</AlertTitle>
              <AlertDescription>
                まだどちらも承認されていないので、このまま申請できます。どちらを承認するかは事務局が決めます。
              </AlertDescription>
            </Alert>
          )}
        </FormSection>

        <FormSection title="利用情報">
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
              onChange={(event) => changeHeadCount(event.target.value)}
              aria-invalid={fieldErrors.headCount !== undefined}
              aria-describedby={
                fieldErrors.headCount !== undefined ? "head_count-error" : undefined
              }
              className="sm:max-w-40"
            />

            <FieldError id="head_count-error" message={fieldErrors.headCount} />
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
              onChange={(event) => changeNote(event.target.value)}
              aria-invalid={fieldErrors.note !== undefined}
              aria-describedby={fieldErrors.note !== undefined ? "note-error" : undefined}
            />

            <p className="text-xs text-muted-foreground">
              使用人数と備考は、申請した団体のメンバーと事務局だけが見られます。
            </p>

            <FieldError id="note-error" message={fieldErrors.note} />
          </div>
        </FormSection>
      </div>

      {/*
       * 縦に積む幅でだけ引く区切り。入力の枠と確認の枠は同じ見た目の Card なので、
       * 続けて並べると、どこまでが入力でどこからが確認なのかが分からない。
       * 横に並ぶ幅（lg 以上）では左右に離れていて、線を引く理由がない。
       */}
      <Separator className="lg:hidden" />

      <SummaryPanel
        groupName={group?.name ?? null}
        facilityName={facility?.name ?? null}
        day={day}
        range={range}
        headCount={headCount}
        canSubmit={canSubmit}
        isSubmitting={isSubmitting}
      />
    </Form>
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
