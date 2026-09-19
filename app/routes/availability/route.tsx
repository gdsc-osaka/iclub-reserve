import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

import { DAYS_IN_WEEK } from "~/components/reservation/availability-week";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createFacilityAvailabilityCalendarQuery } from "~/infra/facility/facility-availability-calendar-query";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { addDays, parseTokyoDateKey, startOfTokyoWeek } from "~/lib/date";
import { QueryErrorCode } from "~/query/error";
import { getAvailabilityCalendarUseCase } from "~/usecases/facility/get-availability-calendar";

import type { Route } from "./+types/route";
import { CalendarCard } from "./calendar-card";
import { FacilityTabs } from "./facility-tabs";

export function meta(_: Route.MetaArgs) {
  return [{ title: "空き状況 | iclub-reserve" }];
}

/**
 * 空き状況カレンダー（SCR-001）に出すデータを取る。
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

  const db = createDb(env.DB);

  const result = await getAvailabilityCalendarUseCase(
    {
      facilityAvailabilityCalendarQuery: createFacilityAvailabilityCalendarQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      facilityId: url.searchParams.get("facility"),
      from: weekStart,
      // 週の終わりは「次の週の日曜 0 時」。この時刻は含まない
      to: addDays(weekStart, DAYS_IN_WEEK),
    },
  );

  if (result.isErr()) {
    if (result.error.code === QueryErrorCode.NotFound) {
      throw data({ message: "Facility not found" }, { status: 404 });
    }

    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return { calendar: result.value, weekStart, now };
}

/**
 * 施設・設備ごとの予約状況を週単位で見る画面（SCR-001 / UC-001）。
 *
 * 他団体の予約も含めて出す。自団体の予約だけでは、その施設が
 * 空いているかどうかが分からないため。ただし他団体の予約は
 * 団体名・日時・ステータスまでしか渡していない（COND-008）。
 *
 * 仮予約も確定した予約と同じように描く。仮予約を隠すと、
 * 申請が重なっていることに気づけないまま同じ時間帯を申請してしまう。
 */
export default function Availability({ loaderData }: Route.ComponentProps) {
  const { calendar, weekStart, now } = loaderData;
  const { facility, facilities, reservations, canApplyReservation } = calendar;

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
      {!canApplyReservation && <CannotApplyNotice />}

      <FacilityTabs facilities={facilities} current={facility} weekStart={weekStart} />

      <CalendarCard
        facility={facility}
        reservations={reservations}
        weekStart={weekStart}
        now={now}
        canApply={canApplyReservation}
      />
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
        予約を申請できるのは、事務局が有効にした団体だけです。所属している団体が承認待ちの場合は、承認されるまでお待ちください。
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
