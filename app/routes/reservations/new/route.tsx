import { env } from "cloudflare:workers";
import { ja } from "date-fns/locale/ja";
import { CalendarCheck, CalendarDays, CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  redirect,
  useNavigate,
  useNavigation,
} from "react-router";

import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
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
  ReservationErrorCode,
  ReservationStatus,
  validateReservationPeriod,
  type ReservationError,
} from "~/domain/reservation";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationFormQuery } from "~/infra/reservation/reservation-form-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import {
  addDays,
  atTokyoMinutes,
  formatFullDate,
  formatMonthDay,
  formatTimeRange,
  fromCalendarDate,
  parseTokyoDateKey,
  parseTokyoTimeKey,
  startOfTokyoDay,
  toCalendarDate,
  toTokyoDateKey,
  toTokyoTimeKey,
} from "~/lib/date";
import type {
  CreatedReservation,
  ReservationFormFacility,
  ReservationFormGroup,
  ReservationFormReservation,
} from "~/query/reservation/reservation-form";
import { createProvisionalReservationUseCase } from "~/usecases/reservation/create-reservation";
import { getReservationFormUseCase } from "~/usecases/reservation/get-reservation-form";

import type { Route } from "./+types/route";
import {
  endSlotMinutes,
  findOverlapping,
  selectSlot,
  startSlotMinutes,
  toBlockedSlots,
  toPastSlots,
  toTimelineReservations,
  type SlotRange,
} from "./reservation-slots";
import { ReservationTimeline, ReservationTimelineLegend } from "./reservation-timeline";

export function meta(_: Route.MetaArgs) {
  return [{ title: "仮予約の申請 | iclub-reserve" }];
}

/** 空き状況カレンダー（SCR-001）の URL を組み立てる */
const toCalendarPath = (facilityId: string, dateKey: string): string =>
  `/availability?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;

/** この画面の URL を組み立てる。施設と週を持ち回るので、リンクは必ずここを通す */
const toFormPath = (facilityId: string, dateKey: string): string =>
  `/reservations/new?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;

/**
 * 表示する施設を 1 件選ぶ。
 *
 * 指定が無い・存在しない施設だったときは先頭に戻す。
 * 空き状況カレンダー（SCR-001）と違ってここを 404 にしないのは、
 * クエリが「画面そのもの」ではなく入力の初期値だから。
 * 初期値が合わないだけで申請を始められなくするのは行きすぎている。
 */
const pickFacilityId = (
  facilities: readonly ReservationFormFacility[],
  requested: string | null,
): string =>
  facilities.find((facility) => facility.id === requested)?.id ?? facilities.at(0)?.id ?? "";

/**
 * 予約申請フォーム（SCR-002）に出すデータを取る。
 *
 * 施設と日付は URL のクエリで受け取る。空き状況カレンダーから
 * 「この施設のこの日時で申請する」と渡ってくるのがこの画面の主な入り口なので、
 * 受け取った内容をそのまま初期値にする。
 * クエリは利用者が自由に書き換えられるので、値はすべて確かめてから使う。
 *
 * 読むのは選んでいる 1 日ぶんだけ。日付を変える操作はこの URL への移動なので、
 * 変えたぶんはその都度ここが読み直す。施設は絞らずに取るため、
 * 施設を切り替えるだけならサーバーへの往復は起きない。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const url = new URL(request.url);

  /*
   * 「いま」はローダーで 1 回だけ読んで画面へ渡す。
   * 描画のたびに new Date() を呼ぶと、サーバーで描いた内容とブラウザで
   * 描き直した内容が食い違い、画面がちらつく。
   */
  const now = new Date();

  // 日付の指定が無い・壊れているときは今日を出す。エラーにはしない
  const day = startOfTokyoDay(parseTokyoDateKey(url.searchParams.get("date")) ?? now);

  const db = createDb(env.DB);

  const result = await getReservationFormUseCase(
    {
      reservationFormQuery: createReservationFormQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
      reservationRepository: createReservationRepository(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      from: day,
      // 終わりは「翌日の 0 時」。この時刻は含まない
      to: addDays(day, 1),
      createdReservationId: url.searchParams.get("created"),
    },
  );

  if (result.isErr()) {
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  const form = result.value;

  return {
    form,
    now,
    isStaff: user.is_staff,
    /** 日付の入力欄の下限。過ぎた日はブラウザの時点で選べなくする */
    todayKey: toTokyoDateKey(now),
    /** 空き状況カレンダーから引き継いだ初期値 */
    initial: {
      facilityId: pickFacilityId(form.facilities, url.searchParams.get("facility")),
      dateKey: toTokyoDateKey(day),
      startMinutes: parseTokyoTimeKey(url.searchParams.get("start")),
    },
  };
}

/** フォームが送ってくる値。入力し直してもらうためにそのまま持ち帰る */
interface FormValues {
  readonly groupId: string;
  readonly facilityId: string;
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly headCount: string;
  readonly note: string;
}

/**
 * 入力の欄ごとのエラー。
 *
 * 日付・開始・終了は 3 つで 1 つの「日時」なので、まとめて `period` に出す。
 * 欄ごとに分けても、直すべき組み合わせが伝わらない。
 */
type FieldErrors = Partial<
  Record<"groupId" | "facilityId" | "period" | "headCount" | "note", string>
>;

const readString = (formData: FormData, name: string): string => {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
};

const readValues = (formData: FormData): FormValues => ({
  groupId: readString(formData, "group_id"),
  facilityId: readString(formData, "facility_id"),
  dateKey: readString(formData, "date"),
  startTime: readString(formData, "start_time"),
  endTime: readString(formData, "end_time"),
  headCount: readString(formData, "head_count"),
  note: readString(formData, "note"),
});

/** 申請の中身。フォームの文字列を確かめ終えた形 */
interface ParsedReservation {
  readonly groupId: string;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
}

/**
 * フォームの文字列を、申請の中身に変える。
 *
 * 欄ごとのエラーを作るのがここの仕事で、申請できるかどうか（COND-001・COND-006）は見ない。
 * あちらは DB を引かないと分からないのでユースケース層が確かめる。
 *
 * 利用時間の判定にドメインの `validateReservationPeriod` をそのまま使っているのは、
 * 同じ規則をここにもう一度書くと、片方だけ直したときに食い違うため。
 */
const parseReservation = (
  values: FormValues,
  now: Date,
): { readonly reservation: ParsedReservation | null; readonly fieldErrors: FieldErrors } => {
  const fieldErrors: FieldErrors = {};

  if (values.groupId === "") fieldErrors.groupId = "申請元の団体を選んでください。";
  if (values.facilityId === "") fieldErrors.facilityId = "施設・設備を選んでください。";

  const day = parseTokyoDateKey(values.dateKey);
  const startMinutes = parseTokyoTimeKey(values.startTime);
  const endMinutes = parseTokyoTimeKey(values.endTime);

  let startAt: Date | null = null;
  let endAt: Date | null = null;

  if (day === null || startMinutes === null || endMinutes === null) {
    fieldErrors.period = "日付と時間帯を選んでください。";
  } else {
    const period = {
      startAt: atTokyoMinutes(day, startMinutes),
      endAt: atTokyoMinutes(day, endMinutes),
    };
    const validated = validateReservationPeriod(period, now);

    if (validated.isErr()) {
      fieldErrors.period = validated.error.message;
    } else {
      startAt = period.startAt;
      endAt = period.endAt;
    }
  }

  const headCount = Number(values.headCount);

  if (
    values.headCount.trim() === "" ||
    !Number.isSafeInteger(headCount) ||
    headCount < RESERVATION_MIN_HEAD_COUNT
  ) {
    fieldErrors.headCount = `使用人数は ${RESERVATION_MIN_HEAD_COUNT} 以上の整数で入力してください。`;
  }

  const note = values.note.trim();

  if (note.length > RESERVATION_NOTE_MAX_LENGTH) {
    fieldErrors.note = `備考は ${RESERVATION_NOTE_MAX_LENGTH} 文字以内で入力してください。`;
  }

  if (Object.keys(fieldErrors).length > 0 || startAt === null || endAt === null) {
    return { reservation: null, fieldErrors };
  }

  return {
    reservation: {
      groupId: values.groupId,
      facilityId: values.facilityId,
      startAt,
      endAt,
      headCount,
      // 備考は任意（INFO-001）。空欄は「書かなかった」として null で保存する
      note: note === "" ? null : note,
    },
    fieldErrors,
  };
};

/**
 * ユースケースのエラーを、画面のどこに出すかへ振り分ける。
 *
 * DB の失敗だけは中身を伝えない。利用者には直しようがなく、
 * 内部の事情を画面に出しても不安にさせるだけのため。
 */
const toFormErrors = (
  error: ReservationError,
): { readonly fieldErrors: FieldErrors; readonly formError: string | null } => {
  switch (error.code) {
    case ReservationErrorCode.ReservationInvalidPeriod:
    case ReservationErrorCode.ReservationConflict:
      return { fieldErrors: { period: error.message }, formError: null };

    case ReservationErrorCode.ReservationForbidden:
    case ReservationErrorCode.ReservationGroupNotEligible:
      return { fieldErrors: { groupId: error.message }, formError: null };

    case ReservationErrorCode.ReservationFacilityNotAvailable:
      return { fieldErrors: { facilityId: error.message }, formError: null };

    case ReservationErrorCode.ReservationInvalidInput:
      return { fieldErrors: {}, formError: error.message };

    default:
      return {
        fieldErrors: {},
        formError: "申請できませんでした。時間をおいて、もう一度お試しください。",
      };
  }
};

/**
 * 仮予約を申請する（UC-002）。
 *
 * ステータスは受け取らない。申請は必ず仮予約として作られる（STATE-001）ので、
 * フォームから送られてくる余地を無くしている。
 *
 * 成功したら、同じ画面の「申請できました」に転送する。
 * 送信の結果をそのまま描くと、完了画面での再読み込みが再送信になり、
 * 同じ予約がもう一度作られてしまう。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);

  const formData = await request.formData();
  const values = readValues(formData);
  const now = new Date();

  const { reservation, fieldErrors } = parseReservation(values, now);

  if (reservation === null) {
    return { values, fieldErrors, formError: null };
  }

  const db = createDb(env.DB);

  const result = await createProvisionalReservationUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
      groupRepository: createGroupRepository(db),
      facilityRepository: createFacilityRepository(db),
    },
    { actorUserId: user.id, isStaff: user.is_staff, now, reservation },
  );

  if (result.isErr()) {
    return { values, ...toFormErrors(result.error) };
  }

  const params = new URLSearchParams({
    created: result.value.reservationId,
    facility: reservation.facilityId,
    date: values.dateKey,
  });

  throw redirect(`/reservations/new?${params.toString()}`);
}

/**
 * 仮予約の申請フォーム（SCR-002 / UC-002）。
 *
 * 申請できるのは有効な団体だけで（COND-006）、事務局は所属に関わらず
 * 任意の団体として申請できる（COND-009）。どちらの候補を出すかはローダーが決めていて、
 * この画面は渡された候補を並べるだけにしている。
 */
export default function NewReservation({ loaderData, actionData }: Route.ComponentProps) {
  const { form, now, isStaff, todayKey, initial } = loaderData;

  if (form.created !== null) {
    return (
      <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
        <CreatedPanel
          created={form.created}
          facilityId={initial.facilityId}
          dateKey={initial.dateKey}
        />
      </PageShell>
    );
  }

  if (form.groups.length === 0 || form.facilities.length === 0) {
    return (
      <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
        <CannotApplyCard
          hasGroup={form.groups.length > 0}
          hasFacility={form.facilities.length > 0}
          isStaff={isStaff}
        />
      </PageShell>
    );
  }

  return (
    <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
      <ApplicationForm
        groups={form.groups}
        facilities={form.facilities}
        reservations={form.reservations}
        now={now}
        todayKey={todayKey}
        initial={initial}
        actionData={actionData ?? null}
      />
    </PageShell>
  );
}

/** 見出しと戻る導線。どの状態でも同じ位置に出す */
function PageShell({
  facilityId,
  dateKey,
  children,
}: Readonly<{ facilityId: string; dateKey: string; children: ReactNode }>) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <Link
          to={toCalendarPath(facilityId, dateKey)}
          className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← 空き状況カレンダーへ戻る
        </Link>

        <h1 className="text-xl font-semibold">仮予約を申請</h1>

        <p className="text-sm text-muted-foreground">
          申請すると仮予約として登録されます。実際に使えるようになるのは、事務局が承認したあとです。
        </p>
      </div>

      {children}
    </main>
  );
}

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
function ApplicationForm({
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
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  /*
   * 日付を変えたあと、その日の予約を読み終えるまでの間。
   * ここで申請を止めておかないと、入力欄が新しい日付、確認欄とタイムラインが
   * 古い日付、という一瞬の食い違いのまま送信できてしまう。
   */
  const isBusy = navigation.state !== "idle";

  const fieldErrors = actionData?.fieldErrors ?? {};
  const submitted = actionData?.values ?? null;

  const [groupId, setGroupId] = useState(submitted?.groupId ?? groups.at(0)?.id ?? "");
  const [facilityId, setFacilityId] = useState(
    submitted?.facilityId ??
      (initial.facilityId === "" ? (facilities.at(0)?.id ?? "") : initial.facilityId),
  );
  /** 日付を選ぶカレンダーを開いているか。選んだら閉じる */
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [headCount, setHeadCount] = useState(submitted?.headCount ?? "");
  const [note, setNote] = useState(submitted?.note ?? "");
  const [range, setRange] = useState<SlotRange | null>(() =>
    toInitialRange(submitted, initial.startMinutes),
  );

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
     * 列の幅は必ず `minmax(0, ...)` で決める。既定の `auto` のままにすると、
     * 日付の並び（横スクロールさせる帯）の幅に列が広がってしまい、
     * スマホでページ全体が横に流れる。
     */
    <Form
      method="post"
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
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
              <Select name="group_id" required value={groupId} onValueChange={setGroupId}>
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
            <Select name="facility_id" required value={facilityId} onValueChange={setFacilityId}>
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="date">日付</Label>

            {/*
             * 送るのはここ。カレンダーは入力欄ではないので、値はこの隠し欄が持つ。
             * URL の日付（＝ローダーが予約を読んだ日）をそのまま送るので、
             * 画面に出ている日と送られる日が食い違うことはない。
             */}
            <input type="hidden" name="date" value={initial.dateKey} />

            <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  className="w-full justify-between font-normal sm:max-w-64"
                  /*
                   * 読み上げ名をここで組み立てている。`<label for>` を付けた要素は
                   * 読み上げ名がラベルの文字だけになり、ボタンに出している日付が
                   * 声では伝わらなくなる（「日付、ボタン」としか読まれない）。
                   */
                  aria-label={`日付 ${formatFullDate(day)}`}
                  aria-invalid={fieldErrors.period !== undefined}
                  aria-describedby={fieldErrors.period !== undefined ? "period-error" : undefined}
                >
                  {formatFullDate(day)}
                  <CalendarDays aria-hidden className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>

              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  locale={ja}
                  autoFocus
                  selected={toCalendarDate(initial.dateKey)}
                  defaultMonth={toCalendarDate(initial.dateKey)}
                  // 過ぎた日は選べない。送られてきた場合はドメインが弾く
                  startMonth={toCalendarDate(todayKey)}
                  disabled={{ before: toCalendarDate(todayKey) ?? new Date() }}
                  onSelect={(selected) => {
                    if (selected === undefined) return;

                    setIsDateOpen(false);

                    /*
                     * 日付を変えることと、その日の予約を読み直すことは必ず一緒に起きる。
                     * タイムラインに描けるのはローダーが読んだ日のぶんだけなので、
                     * 画面の状態にだけ持たせると、空いていない時間帯が空いて見える。
                     *
                     * 履歴に積まないのは、1 日ずつ動かすたびに「戻る」が
                     * その回数ぶん必要になってしまうため。
                     */
                    void navigate(toFormPath(facilityId, fromCalendarDate(selected)), {
                      replace: true,
                      preventScrollReset: true,
                    });
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <ReservationTimeline
            day={day}
            now={now}
            items={items}
            blockedSlots={blockedSlots}
            pastSlots={pastSlots}
            range={range}
            disabled={isBusy}
            onSelectSlot={(slot) => setRange((current) => selectSlot(current, slot, blockedSlots))}
            onSelectRange={setRange}
          />

          <ReservationTimelineLegend />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="start_time">開始時刻</Label>

              {/* 未選択は空文字で表す。Radix はこれを「値が無い」として扱い、placeholder を出す */}
              <Select
                name="start_time"
                required
                value={range === null ? "" : toTokyoTimeKey(range.startMinutes)}
                onValueChange={(value) => {
                  const startMinutes = parseTokyoTimeKey(value);
                  if (startMinutes === null) return;

                  setRange((current) => ({
                    startMinutes,
                    endMinutes:
                      current !== null && current.endMinutes > startMinutes
                        ? current.endMinutes
                        : startMinutes + RESERVATION_STEP_MINUTES,
                  }));
                }}
              >
                <SelectTrigger
                  id="start_time"
                  className="w-full"
                  aria-invalid={fieldErrors.period !== undefined}
                  aria-describedby={fieldErrors.period !== undefined ? "period-error" : undefined}
                >
                  <SelectValue placeholder="選んでください" />
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    {startSlotMinutes.map((minutes) => (
                      <SelectItem
                        key={minutes}
                        value={toTokyoTimeKey(minutes)}
                        disabled={blockedSlots.has(minutes) || pastSlots.has(minutes)}
                      >
                        {toTokyoTimeKey(minutes)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="end_time">終了時刻</Label>

              <Select
                name="end_time"
                required
                value={range === null ? "" : toTokyoTimeKey(range.endMinutes)}
                onValueChange={(value) => {
                  const endMinutes = parseTokyoTimeKey(value);
                  if (endMinutes === null) return;

                  setRange((current) =>
                    current === null
                      ? { startMinutes: endMinutes - RESERVATION_STEP_MINUTES, endMinutes }
                      : { startMinutes: current.startMinutes, endMinutes },
                  );
                }}
              >
                <SelectTrigger
                  id="end_time"
                  className="w-full"
                  aria-invalid={fieldErrors.period !== undefined}
                  aria-describedby={fieldErrors.period !== undefined ? "period-error" : undefined}
                >
                  <SelectValue placeholder="選んでください" />
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    {endSlotMinutes
                      .filter((minutes) => range === null || minutes > range.startMinutes)
                      .map((minutes) => (
                        <SelectItem key={minutes} value={toTokyoTimeKey(minutes)}>
                          {toTokyoTimeKey(minutes)}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

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
              onChange={(event) => setHeadCount(event.target.value)}
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
              onChange={(event) => setNote(event.target.value)}
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

/**
 * 申請内容の確認欄。
 *
 * ステータスを選ぶ欄は置いていない。申請は必ず仮予約として作られるので（STATE-001）、
 * 選べるように見せること自体が誤りになる。代わりに、そうなることをここに書いている。
 */
function SummaryPanel({
  groupName,
  facilityName,
  day,
  range,
  headCount,
  canSubmit,
  isSubmitting,
}: Readonly<{
  groupName: string | null;
  facilityName: string | null;
  day: Date;
  range: SlotRange | null;
  headCount: string;
  canSubmit: boolean;
  isSubmitting: boolean;
}>) {
  return (
    /*
     * 貼り付ける位置は、上の帯（DesktopHeader = 3rem）の下から 1rem 空けたところ。
     * `top-4` のままだと帯の裏に潜り込み、見出しが隠れてしまう。
     * 帯は `sticky top-0 z-20` で、こちらより手前に出る。
     */
    <Card className="lg:sticky lg:top-16">
      <CardHeader>
        <CardTitle className="text-base">この内容で申請します</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <SummaryItem label="団体">{groupName}</SummaryItem>
          <SummaryItem label="施設・設備">{facilityName}</SummaryItem>
          <SummaryItem label="日付">{formatMonthDay(day)}</SummaryItem>
          <SummaryItem label="時間">
            {range === null
              ? null
              : `${toTokyoTimeKey(range.startMinutes)}〜${toTokyoTimeKey(range.endMinutes)}（${formatDuration(
                  range.endMinutes - range.startMinutes,
                )}）`}
          </SummaryItem>
          <SummaryItem label="使用人数">
            {headCount.trim() === "" ? null : `${headCount} 名`}
          </SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          申請を事務局が承認すると、利用予約が確定します。
        </p>
      </CardContent>
      <CardFooter>
        <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
          <CalendarCheck aria-hidden />
          {isSubmitting ? "申請中…" : "この内容で申請する"}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * 選んだ長さを「2 時間」「1 時間 30 分」「30 分」のように書く。
 *
 * 小数（0.5 時間）にしないのは、30 分単位で選べることが読み取れないため。
 */
const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} 分`;
  if (rest === 0) return `${hours} 時間`;

  return `${hours} 時間 ${rest} 分`;
};

/** 確認欄の「項目名 + 値」を 1 組。まだ決まっていない項目はその旨を出す */
function SummaryItem({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">
        {children ?? <span className="font-normal text-muted-foreground">未入力</span>}
      </dd>
    </div>
  );
}

/** 申請が終わったあとの控え。 */
function CreatedPanel({
  created,
  facilityId,
  dateKey,
}: Readonly<{ created: CreatedReservation; facilityId: string; dateKey: string }>) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleCheck aria-hidden className="size-4 text-primary" />
          仮予約を申請しました
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          事務局が承認するまでは、まだ利用できません。結果はメールでお知らせします。
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <SummaryItem label="団体">{created.groupName}</SummaryItem>
          <SummaryItem label="施設・設備">{created.facilityName}</SummaryItem>
          <SummaryItem label="日時">
            {`${formatMonthDay(created.startAt)} ${formatTimeRange(created.startAt, created.endAt)}`}
          </SummaryItem>
          <SummaryItem label="使用人数">{`${created.headCount} 名`}</SummaryItem>
          <SummaryItem label="備考">{created.note}</SummaryItem>

          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">状態</dt>
            <dd>
              <ReservationStatusBadge status={ReservationStatus.Provisional} />
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={toCalendarPath(facilityId, dateKey)}>空き状況カレンダーへ戻る</Link>
          </Button>

          <Button asChild variant="outline">
            <Link to={toFormPath(facilityId, dateKey)}>続けて申請する</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 申請を始められない理由を説明する（COND-006）。
 *
 * フォームを空のまま出しても、何が足りないのかが分からない。
 */
function CannotApplyCard({
  hasGroup,
  hasFacility,
  isStaff,
}: Readonly<{ hasGroup: boolean; hasFacility: boolean; isStaff: boolean }>) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>まだ申請できません</AlertTitle>
      <AlertDescription>
        {!hasGroup &&
          (isStaff
            ? "申請元にできる有効な団体がまだ 1 つもありません。団体を有効にしてから申請してください。"
            : "予約を申請できるのは、事務局が有効にした団体だけです。所属している団体が承認待ちの場合は、承認されるまでお待ちください。")}
        {hasGroup && !hasFacility && "予約できる施設・設備がまだ登録されていません。"}
      </AlertDescription>
    </Alert>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * ルート単位のエラー画面がないと、root.tsx の英語の共通エラー画面が出てしまう。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "ページが見つかりません" : "申請フォームを表示できません"}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">時間をおいて、もう一度お試しください。</p>

          <Link to="/availability" className="text-primary underline underline-offset-4">
            空き状況カレンダーへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
