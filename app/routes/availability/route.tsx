import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isRouteErrorResponse,
  Link,
  redirect,
  useLocation,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { toast } from "sonner";

import { buildDays } from "~/components/reservation/availability-week";
import type { ReservationFormMode } from "~/components/reservation/editor/form-values";
import { NoEnabledGroupReason } from "~/components/reservation/no-enabled-group-reason";
import { ReservationEditError } from "~/components/reservation/reservation-edit-error";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { createFacilityAvailabilityCalendarQuery } from "~/infra/facility/facility-availability-calendar-query";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createD1HolidayQuery } from "~/infra/holiday/d1-holiday-query";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { addDays, parseTokyoDateKey, toTokyoDateKey } from "~/lib/date";
import { createApplicantGroupQuery } from "~/query/reservation/applicant-groups";
import { createUserGroupListQuery } from "~/query/user/user-group-list";
import type { ActionErrors } from "~/routes/_shared/error-response.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import {
  reservationActionErrors,
  reservationErrorResponse,
} from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import { getAvailabilityCalendarUseCase } from "~/usecases/facility/get-availability-calendar";
import { getReservationEditFormUseCase } from "~/usecases/reservation/get-reservation-edit-form";

import type { Route } from "./+types/route";
import {
  CREATE_RESERVATION_INTENT,
  type CreateReservationActionError,
} from "./availability-draft-form";
import { EDIT_RESERVATION_INTENT, type EditReservationActionError } from "./availability-edit-form";
import { AvailabilityPanel } from "./availability-panel";
import { CalendarCard } from "./calendar-card";
import { CALENDAR_WINDOW_DAYS, toCalendarWindowStart } from "./calendar-window";
import { createReservationAction } from "./create-reservation.server";
import { editReservationAction } from "./edit-reservation.server";
import { FacilityTabs } from "./facility-tabs";
import {
  differsOnlyInSelection,
  isEditReservationChanged,
  parseCalendarSelection,
  toDraftParam,
} from "./paths";
import { useCalendarScroll } from "./use-calendar-scroll";
import { toRevealTarget, useCalendarSelection } from "./use-calendar-selection";

export function meta() {
  return [{ title: "空き状況 | i-Club 予約システム" }];
}

/**
 * 空き状況カレンダー（SCR-001）に出すデータを取る。
 *
 * 施設と基準の日は URL のクエリで受け取る。画面の状態を URL に置くことで、
 * 「この施設のこの日」をそのまま人に送れるようにしている。
 * クエリは利用者が自由に書き換えられるので、値はすべて確かめてから使う。
 *
 * 読むのは、基準の日の週の前の週から 4 週間（ADR-014 決定 4）。
 *
 * URL の選択が変更（edit）のときは、変更する予約も同時に読む（ADR-014 決定 16）。
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

  // 日付の指定が無い・壊れているときは今日を基準の日にする。エラーにはしない
  const anchorDate = parseTokyoDateKey(url.searchParams.get("date")) ?? now;
  const windowStart = toCalendarWindowStart(anchorDate);

  const db = createDb(env.DB);

  const parsedSelection = parseCalendarSelection(url.searchParams);

  // 空き状況の読み取りと、変更する予約の読み取りを同時に呼ぶ（順に待つと D1 との往復がそのまま待ち時間になるため）
  const calendarPromise = getAvailabilityCalendarUseCase(
    {
      facilityAvailabilityCalendarQuery: createFacilityAvailabilityCalendarQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
      holidayQuery: createD1HolidayQuery(db),
      applicantGroupQuery: createApplicantGroupQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      facilityId: url.searchParams.get("facility"),
      from: windowStart,
      // 期間の終わり（to はその時刻を含まない）
      to: addDays(windowStart, CALENDAR_WINDOW_DAYS),
      now,
    },
  );

  const editPromise =
    parsedSelection?.kind === "edit"
      ? getReservationEditFormUseCase(
          {
            reservationRepository: createReservationRepository(db),
            membershipRepository: createMembershipRepository(db),
            groupRepository: createGroupRepository(db),
          },
          {
            reservationId: parsedSelection.reservationId,
            actorUserId: user.id,
            isStaff: user.is_staff,
            now,
          },
        )
      : null;

  const [calendarResult, editResult] = await Promise.all([calendarPromise, editPromise]);

  if (calendarResult.isErr()) {
    // 無い施設は 404、DB の失敗は 500 になる。どちらもログに残る
    throw queryErrorResponse(
      { where: "availability.loader", userId: user.id },
      calendarResult.error,
    );
  }

  if (editResult !== null && editResult.isErr()) {
    throw reservationErrorResponse(
      { where: "availability.edit.loader", userId: user.id },
      editResult.error,
    );
  }

  const edit = editResult === null ? null : editResult.value;

  return {
    calendar: calendarResult.value,
    windowStart,
    anchorKey: toTokyoDateKey(anchorDate),
    now,
    edit,
  };
}

/**
 * 空き状況カレンダーからの操作。欄からの予約の作成（申請・直接作成）および変更と、
 * 事務局の状態変更（承認・却下・事務局キャンセル）を受け付ける。
 *
 * 戻り値の型を書いているのは、画面の側で失敗を `intent` で見分けられるようにするため。
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<
  CreateReservationActionError | EditReservationActionError | ActionErrors<never> | Response
> {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === CREATE_RESERVATION_INTENT) {
    return createReservationAction({ request, formData, user });
  }

  if (intent === EDIT_RESERVATION_INTENT) {
    return editReservationAction({ request, formData, user });
  }

  const reservationId = formData.get("reservationId");
  const reason = formData.get("reason");

  if (typeof reservationId !== "string" || !reservationId) {
    return { formError: "予約が指定されていません。" };
  }

  /*
   * 事務局の操作のみを受け付ける。可否はユースケースに任せ、
   * 非事務局の操作は Forbidden で弾かれてログに残る。
   */
  const transition = parseReservationTransition(intent);

  if (transition === null || !isStaffTransition(transition)) {
    return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
  }

  const db = createDb(env.DB);
  const result = await changeReservationStatus(db, request, user, {
    reservationId,
    transition,
    reason,
    unlockArrangement: formData.get("unlockArrangement"),
    now: new Date(),
  });

  if (result.isErr()) {
    return reservationActionErrors(
      { where: `availability.${transition}`, userId: user.id },
      result.error,
    );
  }

  /*
   * 操作のあとは、いま見ていたカレンダーへ戻す（同じ内容の再送信を防ぐ PRG）。
   * `.` は URL の階層ではなく「いま表示しているルート」を指し、React Router がルートのパスから
   * 解決する（事務局の予約一覧と同じ）。施設と週を外さないよう、クエリは残す。
   */
  return redirect(`.${new URL(request.url).search}`);
}

/**
 * 欄を開く・閉じる・選び直すだけでは、loader を走らせない（ADR-014 決定 8・16）。
 *
 * 開いているもの（`reservation`・`draft`）は画面の中だけで決まり、読むデータは変わらない。
 * ただし、変更の欄を開いた・別の予約の変更に替えたときは、変更する予約を読むためローダーを再実行する。
 * 送信の後と、同じ URL での読み直し（`revalidate()`）は、今までどおり走らせる。
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const isSelectionOnly =
    formMethod === undefined &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search &&
    differsOnlyInSelection(currentUrl.searchParams, nextUrl.searchParams);

  if (isSelectionOnly) {
    return isEditReservationChanged(currentUrl.searchParams, nextUrl.searchParams);
  }

  return defaultShouldRevalidate;
}

/** 欄から送った操作。成功したときに出すトーストを決める */
type SubmittedAction =
  | { readonly kind: "create"; readonly mode: ReservationFormMode }
  | { readonly kind: "edit" };

/**
 * 施設・設備ごとの予約状況を見る画面（SCR-001 / UC-001）。
 *
 * 他団体の予約も含めて出す。自団体の予約だけでは、その施設が
 * 空いているかどうかが分からないため。ただし他団体の予約は
 * 団体名・日時・ステータスまでしか渡していない（COND-008）。
 *
 * 仮予約も確定した予約と同じように描く。仮予約を隠すと、
 * 申請が重なっていることに気づけないまま同じ時間帯を申請してしまう。
 */
export default function Availability({ loaderData, actionData }: Route.ComponentProps) {
  const { calendar, windowStart, anchorKey, now, edit } = loaderData;
  const { facility, facilities, reservations, canApplyReservation } = calendar;

  const days = useMemo(
    () => buildDays(windowStart, CALENDAR_WINDOW_DAYS, now, calendar.holidayDateKeys),
    [windowStart, now, calendar.holidayDateKeys],
  );

  /** スマホで欄を画面いっぱいに広げているか（ADR-014 決定 13） */
  const [isExpanded, setIsExpanded] = useState(false);

  const scroll = useCalendarScroll({ days, anchorKey, todayKey: toTokyoDateKey(now) });
  const selectionOps = useCalendarSelection({
    facilityId: facility.id,
    anchorKey,
    reservations,
    days,
    canApply: canApplyReservation,
    editReservation: edit?.reservation ?? null,
  });
  const { selection, openDraft, openReservation } = selectionOps;

  /** 空いている枠を押して申請または変更へ進めるか（ADR-014 決定 15） */
  const canPickSlot = canApplyReservation || selection?.kind === "edit";

  /*
   * 欄が閉じたら、広げていない状態に戻す（戻る操作で閉じたときも）。
   * effect で戻すと、閉じた直後の 1 回はカレンダーを隠したまま描いてしまうので、描画の中で戻す。
   */
  if (selection === null && isExpanded) setIsExpanded(false);

  /*
   * 予約を作る・変更する操作の失敗（`intent` 付きで返る）は欄の中に出すので、画面の上の「操作に失敗しました」は
   * 事務局の操作（承認・却下・キャンセル）の失敗のときだけ出す。
   */
  const createError =
    actionData !== undefined &&
    "intent" in actionData &&
    actionData.intent === CREATE_RESERVATION_INTENT
      ? actionData
      : null;
  const editError =
    actionData !== undefined &&
    "intent" in actionData &&
    actionData.intent === EDIT_RESERVATION_INTENT
      ? actionData
      : null;
  const staffError =
    actionData !== undefined && !("intent" in actionData) ? actionData.formError : null;

  /*
   * 予約を作れた・変更できたときは、トーストで知らせる（ADR-014 決定 10・15）。
   *
   * 成功すると action が予約を開く URL へ転送し、欄は切り替わってしまうので、ここで見る。
   * 欄から送ったときに操作（作成か変更か）を覚えておき、次のどちらかで答え合わせをする。
   * - 転送が終わって URL が変わった（`location.key`）: 予約を開いていれば知らせる
   * - 失敗が返ってきた（`actionData`）: 知らせずに忘れる。欄の中に誤りが出る
   *
   * `useNavigation()` の読み込み中（loading）を見て決めることはしない。React Router は状態の更新を
   * トランジションで描くので、読み込みが速いと loading を描かずに idle へ進み、見逃すことがある。
   */
  const location = useLocation();
  const submittedActionRef = useRef<SubmittedAction | null>(null);

  useEffect(() => {
    const submitted = submittedActionRef.current;
    if (submitted === null) return;
    submittedActionRef.current = null;
    if (selection?.kind !== "reservation") return;

    if (submitted.kind === "edit") {
      toast.success("予約を変更しました");
    } else if (submitted.mode === "direct") {
      toast.success("承認済みの予約を作成しました", { description: "メールは送信されません。" });
    } else {
      toast.success("仮予約を申請しました", {
        description:
          "事務局の承認後、ご利用いただけます。承認・却下の結果はメールでお知らせします。",
      });
    }
  }, [location.key, createError, editError]);

  /*
   * 開いたものが変わったら、その日と時刻をカレンダーの見える範囲に入れる。
   * 位置が変わったときだけ送る。描画のたびに送ると、欄を開いたままカレンダーを動かせなくなる。
   * 位置（日と時間帯）は仮の枠と同じ形なので、比べるためのキーは仮の枠の URL の値で作る。
   */
  const revealTarget = toRevealTarget(selection, reservations);
  const revealKey = revealTarget === null ? null : toDraftParam(revealTarget);
  useEffect(() => {
    if (revealTarget !== null) scroll.reveal(revealTarget.dateKey, revealTarget.range);
  }, [revealKey]);

  return (
    /*
     * この画面だけは、ページ全体ではなくカレンダーの中身をスクロールさせる。
     * 見出しや凡例が上へ流れてしまうと、
     * 下の方の日付を見ているときに「いつの日を見ているのか」が分からなくなる。
     *
     * そのため高さを画面ぴったりに固定し（--app-content-height）、
     * あふれる部分は中の `overflow` に任せる。
     */
    <main className="mx-auto flex h-(--app-content-height) w-full max-w-6xl flex-col gap-4 overflow-hidden p-4 md:p-6">
      {staffError && (
        <Alert variant="destructive" className="shrink-0">
          <CircleAlert aria-hidden className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{staffError}</AlertDescription>
        </Alert>
      )}

      {!canApplyReservation && <CannotApplyNotice />}

      <FacilityTabs
        facilities={facilities}
        current={facility}
        anchorKey={anchorKey}
        selection={selection}
      />

      {/* カレンダーと欄を並べる。スマホは縦（欄が下）、PC は横（欄が右）（ADR-014 決定 7） */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <CalendarCard
          facility={facility}
          reservations={reservations}
          days={days}
          anchorKey={anchorKey}
          now={now}
          canPickSlot={canPickSlot}
          scroll={scroll}
          selection={selection}
          onOpenDraft={openDraft}
          onOpenReservation={openReservation}
          className={isExpanded ? "max-md:hidden" : undefined}
        />

        {selection !== null && (
          <AvailabilityPanel
            calendar={calendar}
            anchorKey={anchorKey}
            days={days}
            now={now}
            selection={selection}
            selectionOps={selectionOps}
            createError={createError}
            editError={editError}
            editReservation={edit?.reservation ?? null}
            isDirectEdit={edit?.isDirect ?? false}
            onSubmitCreate={(mode) => {
              submittedActionRef.current = { kind: "create", mode };
            }}
            onSubmitEdit={() => {
              submittedActionRef.current = { kind: "edit" };
            }}
            isExpanded={isExpanded}
            onExpandedChange={setIsExpanded}
          />
        )}
      </div>
    </main>
  );
}

/**
 * 予約を申請できない人に出す案内（COND-006）。
 *
 * 申請の導線を消さずに、押せない理由を書いている。
 * 導線ごと消すと、なぜ申請できないのかが分からないまま画面を探し回ることになる。
 *
 * 事務局かどうかで文言を分けていないのは、事務局がここに来ないため。
 * 事務局は所属に関わらず任意の団体として申請できるので（COND-009）、
 * `canApplyReservation` が false になることがない。
 */
function CannotApplyNotice() {
  return (
    <Alert className="shrink-0 border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>まだ予約を申請できません</AlertTitle>
      <AlertDescription>
        <NoEnabledGroupReason />
        空き状況の確認はこのままご利用いただけます。
      </AlertDescription>
    </Alert>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 404 / 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * 変更する予約を読めなかったときは、変更できない理由に応じた見出しと戻り道を出す（ADR-014 決定 16）。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const [searchParams] = useSearchParams();
  const selection = parseCalendarSelection(searchParams);

  if (selection?.kind === "edit") {
    return (
      <ReservationEditError
        error={error}
        reservationId={selection.reservationId}
        backLink={{ to: "/availability", label: "空き状況へ戻る" }}
      />
    );
  }

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "施設・設備が見つかりません" : "空き状況を表示できません"}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isNotFound
              ? "URL が間違っているか、まだ利用できる施設・設備が登録されていません。"
              : "時間をおいて、もう一度お試しください。"}
          </p>

          <Link to="/" className="text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
