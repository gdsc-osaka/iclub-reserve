import { env } from "cloudflare:workers";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Plus } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

import { AvailabilityDraftCard } from "~/components/reservation/availability-detail-card";
import { buildWeekDays, DAYS_IN_WEEK } from "~/components/reservation/availability-week";
import { AvailabilityWeekAgenda } from "~/components/reservation/availability-week-agenda";
import { AvailabilityWeekGrid } from "~/components/reservation/availability-week-grid";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "~/domain/facility";
import { createDb } from "~/infra/db";
import { createFacilityAvailabilityCalendarQuery } from "~/infra/facility/facility-availability-calendar-query";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import {
  addDays,
  formatFullDate,
  formatMonthDay,
  parseTokyoDateKey,
  startOfTokyoWeek,
  toTokyoDateKey,
} from "~/lib/date";
import { cn } from "~/lib/utils";
import { QueryErrorCode } from "~/query/error";
import type { AvailabilityFacility } from "~/query/facility/facility-availability-calendar";
import { getAvailabilityCalendarUseCase } from "~/usecases/facility/get-availability-calendar";

import type { Route } from "./+types/availability";

export function meta(_: Route.MetaArgs) {
  return [{ title: "空き状況 | iclub-reserve" }];
}

/** この画面の URL を組み立てる。施設と週を両方持ち回るので、リンクは必ずここを通す */
const toCalendarPath = (facilityId: string, date: Date): string =>
  `/availability?facility=${encodeURIComponent(facilityId)}&date=${toTokyoDateKey(date)}`;

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

  return { calendar: result.value, weekStart, now, isStaff: user.is_staff };
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
  const { calendar, weekStart, now, isStaff } = loaderData;
  const { facility, facilities, reservations, canApplyReservation } = calendar;

  const days = buildWeekDays(weekStart, now);

  /*
   * 押したものの中身は、押した場所に重なる吹き出し（Popover）で出す。
   * どれを開いているかは吹き出しが自分で覚えるので、この画面では持たない。
   *
   * 以前はカレンダーの上に欄を差し込んでいたが、押すたびに表が上下に動いて、
   * 次に狙っていた枠が逃げてしまっていた。
   *
   * 施設や週を切り替えると、帯も空き枠も作り直されるので吹き出しは閉じる。
   * 別の施設・別の日の内容が残ったままになることはない（COND-008）。
   */
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
      {!canApplyReservation && <CannotApplyNotice isStaff={isStaff} />}

      <FacilityTabs facilities={facilities} current={facility} weekStart={weekStart} />

      <Card className="min-h-0 flex-1 gap-0 overflow-hidden py-0">
        <CardHeader className="flex shrink-0 flex-wrap items-center gap-3 border-b py-4">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{facility.name}</span>
          </CardTitle>

          {canApplyReservation && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm">
                  <Plus aria-hidden />
                  {isStaff ? "予約を作成" : "仮予約を申請"}
                </Button>
              </PopoverTrigger>

              <PopoverContent align="start" className="w-72">
                <AvailabilityDraftCard
                  draft={{ facility, day: null, startHour: null }}
                  isStaff={isStaff}
                />
              </PopoverContent>
            </Popover>
          )}

          <WeekNavigation facilityId={facility.id} weekStart={weekStart} today={now} />
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col px-0">
          <Legend />

          {/*
           * 横長の画面とスマホで別の並べ方を出している。
           * どちらを出すかは CSS の画面幅だけで決めていて、JavaScript では判定していない。
           * 画面幅を JavaScript で測ると、表示されたあとに切り替わってちらつく。
           */}
          <div className="hidden min-h-0 flex-1 md:block">
            <AvailabilityWeekGrid
              days={days}
              reservations={reservations}
              facility={facility}
              now={now}
              canApply={canApplyReservation}
              isStaff={isStaff}
            />
          </div>

          {/* スマホでは日ごとの一覧だけをスクロールさせる。上の帯（週の切り替え・凡例）は動かさない */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:hidden">
            <AvailabilityWeekAgenda
              days={days}
              reservations={reservations}
              facility={facility}
              canApply={canApplyReservation}
              isStaff={isStaff}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * 施設・設備の切り替え。
 *
 * 選ぶたびにサーバーへ取り直すので、プルダウンではなくリンクにしている。
 * リンクなら JavaScript が動いていなくても切り替えられ、
 * 「この施設のこの週」をそのまま人に送れる。
 */
function FacilityTabs({
  facilities,
  current,
  weekStart,
}: Readonly<{
  facilities: readonly AvailabilityFacility[];
  current: AvailabilityFacility;
  weekStart: Date;
}>) {
  return (
    <nav
      aria-label="施設・設備の切り替え"
      className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <ul className="flex w-max gap-2">
        {facilities.map((item) => {
          const isCurrent = item.id === current.id;

          return (
            <li key={item.id}>
              <Link
                to={toCalendarPath(item.id, weekStart)}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {item.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 前の週・今週・次の週への移動。あわせて表示中の期間を出す。 */
function WeekNavigation({
  facilityId,
  weekStart,
  today,
}: Readonly<{ facilityId: string; weekStart: Date; today: Date }>) {
  const weekEnd = addDays(weekStart, DAYS_IN_WEEK - 1);

  return (
    <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground md:flex-none">
        {formatFullDate(weekStart)} 〜 {formatMonthDay(weekEnd)}
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <Button asChild variant="outline" size="icon" aria-label="前の週">
          <Link to={toCalendarPath(facilityId, addDays(weekStart, -DAYS_IN_WEEK))}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>

        <Button asChild variant="outline">
          <Link to={toCalendarPath(facilityId, today)}>今週</Link>
        </Button>

        <Button asChild variant="outline" size="icon" aria-label="次の週">
          <Link to={toCalendarPath(facilityId, addDays(weekStart, DAYS_IN_WEEK))}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * 色と印の意味を説明する凡例。
 *
 * 色みでステータス、左端の線の太さで自団体かどうかを表しているので、
 * 説明が無いと「太い細いに意味があるのか」が分からない。
 */
function Legend() {
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-sm border border-primary/40 bg-primary/20" />
        承認済み
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-3 rounded-sm border border-dashed border-amber-500/50 bg-amber-500/20"
        />
        仮予約
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-1 rounded-sm bg-primary" />
        左端の線が太いものが自団体の予約
      </li>
      <li className="ml-auto hidden md:block">
        予約を押すと内容、空いている時間を押すとその日時で申請に進めます（{FACILITY_OPEN_HOUR}
        :00〜{FACILITY_CLOSE_HOUR}:00）
      </li>
    </ul>
  );
}

/**
 * 予約を申請できない人に出す案内（COND-006）。
 *
 * 申請の導線を消さずに、押せない理由を書いている。
 * 導線ごと消すと、なぜ申請できないのかが分からないまま画面を探し回ることになる。
 */
function CannotApplyNotice({ isStaff }: Readonly<{ isStaff: boolean }>) {
  return (
    <Alert className="shrink-0 border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>まだ予約を申請できません</AlertTitle>
      <AlertDescription>
        {isStaff
          ? "予約を申請できる団体に所属していません。"
          : "予約を申請できるのは、事務局が有効にした団体だけです。所属している団体が承認待ちの場合は、承認されるまでお待ちください。"}
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
