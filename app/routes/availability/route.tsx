import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import { DAYS_IN_WEEK } from "~/components/reservation/availability-week";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { addDays, parseTokyoDateKey, startOfTokyoWeek } from "~/lib/date";
import { findFacilityAvailabilityCalendar } from "~/query/facility/facility-availability-calendar";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";

import type { Route } from "./+types/route";
import { CalendarCard } from "./calendar-card";
import { FacilityTabs } from "./facility-tabs";

export function meta() {
  return [{ title: "空き状況 | iclub-reserve" }];
}

/**
 * 空き状況カレンダー（SCR-001）に出すデータを取る。
 *
 * 事務局専用の画面（ADR-013）。事務局かどうかは読み取りの門番が判定し、
 * 事務局でなければ 403 になる（ErrorBoundary が案内を出す）。
 *
 * 表示する施設と週は URL のクエリで受け取る。画面の状態を URL に置くことで、
 * 「この施設のこの週」をそのまま人に送れるようにしている。
 * クエリは利用者が自由に書き換えられるので、値はすべて確かめてから使う。
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

  // 日付の指定が無い・壊れているときは今週を出す。エラーにはしない
  const anchorDate = parseTokyoDateKey(url.searchParams.get("date")) ?? now;
  const weekStart = startOfTokyoWeek(anchorDate);

  const result = await findFacilityAvailabilityCalendar(createDb(env.DB), {
    isStaff: user.is_staff,
    facilityId: url.searchParams.get("facility"),
    from: weekStart,
    // 週の終わりは「次の週の日曜 0 時」。この時刻は含まない
    to: addDays(weekStart, DAYS_IN_WEEK),
  });

  if (result.isErr()) {
    // 事務局でなければ 403、無い施設は 404、DB の失敗は 500 になる。どれもログに残る
    throw queryErrorResponse({ where: "availability.loader", userId: user.id }, result.error);
  }

  return { calendar: result.value, weekStart, now };
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
    return { formError: "不正な操作です。" };
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
 * 施設・設備ごとの予約状況を週単位で見る画面（SCR-001 / UC-001）。事務局専用（ADR-013）。
 *
 * 全団体の予約を全項目で出す（COND-009）。
 * 仮予約も確定した予約と同じように描く。仮予約を隠すと、
 * 申請が重なっていることに気づけないまま承認や直接作成をしてしまう。
 */
export default function Availability({ loaderData, actionData }: Route.ComponentProps) {
  const { calendar, weekStart, now } = loaderData;
  const { facility, facilities, reservations } = calendar;

  return (
    /*
     * この画面だけは、ページ全体ではなくカレンダーの中身をスクロールさせる。
     * 週の切り替えや凡例が上へ流れてしまうと、
     * 下の方の日付を見ているときに「いつの週を見ているのか」が分からなくなる。
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

      <FacilityTabs facilities={facilities} current={facility} weekStart={weekStart} />

      <CalendarCard
        facility={facility}
        reservations={reservations}
        weekStart={weekStart}
        now={now}
        holidayDateKeys={calendar.holidayDateKeys}
      />
    </main>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 403 / 404 / 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * ルート単位のエラー画面がないと、root.tsx の英語の共通エラー画面が出てしまう。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : null;

  if (status === 403) {
    return <StaffOnlyNotice />;
  }

  const isNotFound = status === 404;

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

/**
 * 事務局でない人が開いたときの案内（ADR-013）。
 *
 * 以前は団体の利用者もこの画面を使っていたので、古いリンクやブックマークから来る人がいる。
 * 「権限がありません」だけでは何をすればよいか分からないので、
 * 空きを確かめたいなら申請フォームで、自分たちの予約なら予約一覧で見られることを書いて、
 * そのまま進めるようにしている。
 */
function StaffOnlyNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">事務局スタッフ専用ページです</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            空き状況のカレンダーは、事務局の業務用の画面です。
            予約を申請するときは、申請フォームで施設と日付を選ぶと、その日の空き状況を確かめられます。
            自団体の予約は、予約一覧で確かめられます。
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild>
              <Link to="/reservations/new">予約を申請する</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/reservations">予約一覧を見る</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
