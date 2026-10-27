import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  isRouteErrorResponse,
  Link,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { buildDays } from "~/components/reservation/availability-week";
import { NoEnabledGroupReason } from "~/components/reservation/no-enabled-group-reason";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { createFacilityAvailabilityCalendarQuery } from "~/infra/facility/facility-availability-calendar-query";
import { createD1HolidayQuery } from "~/infra/holiday/d1-holiday-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { addDays, parseTokyoDateKey, toTokyoDateKey } from "~/lib/date";
import { createUserGroupListQuery } from "~/query/user/user-group-list";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import { getAvailabilityCalendarUseCase } from "~/usecases/facility/get-availability-calendar";

import type { Route } from "./+types/route";
import { AvailabilityPanel } from "./availability-panel";
import { CalendarCard } from "./calendar-card";
import { CALENDAR_WINDOW_DAYS, toCalendarWindowStart } from "./calendar-window";
import { FacilityTabs } from "./facility-tabs";
import { differsOnlyInSelection } from "./paths";
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

  const result = await getAvailabilityCalendarUseCase(
    {
      facilityAvailabilityCalendarQuery: createFacilityAvailabilityCalendarQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
      holidayQuery: createD1HolidayQuery(db),
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

  if (result.isErr()) {
    // 無い施設は 404、DB の失敗は 500 になる。どちらもログに残る
    throw queryErrorResponse({ where: "availability.loader", userId: user.id }, result.error);
  }

  return { calendar: result.value, windowStart, anchorKey: toTokyoDateKey(anchorDate), now };
}

/**
 * 空き状況カレンダーからの事務局状態変更アクション（承認・却下・事務局キャンセル）。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");
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
 * 欄を開く・閉じる・選び直すだけでは、loader を走らせない（ADR-014 決定 8）。
 *
 * 開いているもの（`reservation`・`draft`）は画面の中だけで決まり、読むデータは変わらない。
 * 走らせると、押すたびに 4 週間ぶんを読み直して、欄が開くのが遅れる。
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

  return isSelectionOnly ? false : defaultShouldRevalidate;
}

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
  const { calendar, windowStart, anchorKey, now } = loaderData;
  const { facility, facilities, reservations, canApplyReservation } = calendar;

  const days = useMemo(
    () => buildDays(windowStart, CALENDAR_WINDOW_DAYS, now, calendar.holidayDateKeys),
    [windowStart, now, calendar.holidayDateKeys],
  );

  const scroll = useCalendarScroll({ days, anchorKey, todayKey: toTokyoDateKey(now) });
  const { selection, openDraft, openReservation, close } = useCalendarSelection({
    facilityId: facility.id,
    anchorKey,
    reservations,
    days,
    canApply: canApplyReservation,
  });

  /*
   * 開いたものが変わったら、その日と時刻をカレンダーの見える範囲に入れる。
   * 位置が変わったときだけ送る。描画のたびに送ると、欄を開いたままカレンダーを動かせなくなる。
   */
  const revealTarget = toRevealTarget(selection, reservations);
  const revealKey =
    revealTarget === null
      ? null
      : `${revealTarget.dateKey}T${revealTarget.range.startMinutes}-${revealTarget.range.endMinutes}`;
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
      {actionData?.formError && (
        <Alert variant="destructive" className="shrink-0">
          <CircleAlert aria-hidden className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{actionData.formError}</AlertDescription>
        </Alert>
      )}

      {!canApplyReservation && <CannotApplyNotice />}

      <FacilityTabs facilities={facilities} current={facility} anchorKey={anchorKey} />

      {/* カレンダーと欄を並べる。スマホは縦（欄が下）、PC は横（欄が右）（ADR-014 決定 7） */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <CalendarCard
          facility={facility}
          reservations={reservations}
          days={days}
          anchorKey={anchorKey}
          now={now}
          canApply={canApplyReservation}
          scroll={scroll}
          selection={selection}
          onOpenDraft={openDraft}
          onOpenReservation={openReservation}
        />

        {selection !== null && (
          <AvailabilityPanel
            selection={selection}
            facility={facility}
            days={days}
            reservations={reservations}
            now={now}
            canCreateDirectly={calendar.canCreateDirectly}
            onClose={close}
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
 * ルート単位のエラー画面がないと、root.tsx の英語の共通エラー画面が出てしまう。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
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
