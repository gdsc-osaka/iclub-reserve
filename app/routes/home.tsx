import { env } from "cloudflare:workers";
import { CalendarClock, History, Info, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

import { GroupStatusBadge } from "~/components/group/group-status-badge";
import { ReservationStatusBadge } from "~/components/reservation/reservation-status-badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { GroupStatus } from "~/domain/group";
import { ReservationStatus } from "~/domain/reservation";
import { createDb } from "~/infra/db";
import { createUserReservationListQuery } from "~/infra/user/user-reservation-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatReservationPeriod } from "~/lib/date";
import type {
  UserReservationListGroup,
  UserReservationListItem,
} from "~/query/user/user-reservation-list";
import { getUserReservationListUseCase } from "~/usecases/user/get-user-reservation-list";

import type { Route } from "./+types/home";

export function meta() {
  return [
    { title: "予約 | iclub-reserve" },
    { name: "description", content: "所属している団体の予約を確認できます。" },
  ];
}

/**
 * トップページのデータを取得する (SCR-003 の団体側)。
 *
 * 見えるのは自分が所属している団体の予約だけ。
 * 他団体の予約は空き状況カレンダー (SCR-001) で公開範囲のみを確認する形にしており、
 * この画面には出さない (COND-008)。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const db = createDb(env.DB);

  const listResult = await getUserReservationListUseCase(
    { userReservationListQuery: createUserReservationListQuery(db) },
    // 閲覧者は必ずセッションから取る。ここを URL の値にすると他人の予約が見えてしまう
    { viewerUserId: user.id, now: new Date() },
  );

  if (listResult.isErr()) {
    // 失敗の原因は画面に出さない代わりに、必ずログへ残す。
    // ここで捨てると、利用者からは「表示できません」としか分からない障害になる。
    console.error("予約一覧の取得に失敗しました。", listResult.error);

    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return listResult.value;
}

/**
 * トップページ。自分が所属している団体の予約を「これから」と「履歴」に分けて並べる。
 *
 * 予約は申請したら終わりではなく、承認・変更・キャンセルと状態が動く。
 * 利用者が最初に知りたいのは「自分の申請がいまどうなっているか」なので、
 * 施設ごとの空き状況ではなくこちらをトップに置いている。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { groups, upcoming, past, isPastTruncated } = loaderData;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">予約</h1>
        <p className="text-sm text-muted-foreground">
          あなたが所属している団体の予約です。他の団体の予約は表示されません。
        </p>
      </header>

      {groups.length > 0 && <GroupList groups={groups} />}

      <section className="space-y-3">
        <SectionHeading icon={CalendarClock} title="これからの予約" count={upcoming.length} />

        {upcoming.length === 0 ? (
          <EmptyState {...describeNoUpcoming(groups)} />
        ) : (
          <ul className="space-y-3">
            {upcoming.map((reservation) => (
              <ReservationItem key={reservation.reservationId} reservation={reservation} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <SectionHeading icon={History} title="履歴" count={past.length} />

          <ul className="space-y-3">
            {past.map((reservation) => (
              <ReservationItem key={reservation.reservationId} reservation={reservation} />
            ))}
          </ul>

          {isPastTruncated && (
            <p className="text-xs text-muted-foreground">
              新しい順に {past.length} 件を表示しています。
            </p>
          )}
        </section>
      )}
    </main>
  );
}

/** 所属している団体。予約を申請できる状態かどうかがここで分かる。 */
function GroupList({ groups }: Readonly<{ groups: readonly UserReservationListGroup[] }>) {
  return (
    <section className="space-y-3">
      <SectionHeading icon={Users} title="所属している団体" count={groups.length} />

      <ul className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <li key={group.groupId}>
            <Link
              to={`/groups/${group.groupId}`}
              className="inline-flex items-center gap-2 rounded-full bg-card py-1 pr-1 pl-3 text-sm ring-1 ring-foreground/10 ring-inset transition-colors hover:bg-muted"
            >
              {group.name}
              <GroupStatusBadge status={group.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 予約 1 件分のカード。 */
function ReservationItem({ reservation }: Readonly<{ reservation: UserReservationListItem }>) {
  return (
    <li>
      <Card>
        <CardHeader>
          <CardTitle>{reservation.facilityName}</CardTitle>
          <CardDescription>
            {formatReservationPeriod(reservation.startAt, reservation.endAt)}
          </CardDescription>
          <CardAction>
            <ReservationStatusBadge status={reservation.status} />
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {reservation.groupName} ・ {reservation.headCount} 名
          </p>

          {reservation.note !== null && reservation.note !== "" && (
            <p className="text-sm whitespace-pre-wrap">{reservation.note}</p>
          )}

          <StatusReason reservation={reservation} />
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * 却下・事務局キャンセルの理由。
 *
 * 事務局は理由の入力を必須とされている (COND-002)。
 * 書いてもらった理由が申請した側に届かないと、必須にした意味がなくなる。
 * 逆に、自分たちで取りやめたときの任意の理由はここでは出さない。
 */
function StatusReason({ reservation }: Readonly<{ reservation: UserReservationListItem }>) {
  const isStaffDecision =
    reservation.status === ReservationStatus.Rejected ||
    reservation.status === ReservationStatus.CancelledByStaff;

  if (!isStaffDecision || reservation.statusReason === null || reservation.statusReason === "") {
    return null;
  }

  return (
    <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">
      事務局より: {reservation.statusReason}
    </p>
  );
}

/** 節の見出し。件数を添えて、全部でいくつあるのかがひと目で分かるようにする。 */
function SectionHeading({
  icon: Icon,
  title,
  count,
}: Readonly<{ icon: LucideIcon; title: string; count: number }>) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon aria-hidden className="size-4" />
      {title}
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{count}</span>
    </h2>
  );
}

/** 予約が 1 件も無いときの案内。 */
function EmptyState({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info aria-hidden className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/**
 * 予約が無いときに何を案内するかを決める。
 *
 * 同じ「0 件」でも、利用者が次に取るべき行動は状況ごとに違う。
 * ひとまとめに「予約がありません」とだけ書くと、
 * 団体に入っていない人が申請できない理由に気づけない。
 */
const describeNoUpcoming = (
  groups: readonly UserReservationListGroup[],
): { title: string; description: string } => {
  if (groups.length === 0) {
    return {
      title: "所属している団体がありません",
      description:
        "予約は団体として申請します。団体の管理者か事務局に招待を依頼してください。招待を承諾すると、この画面に予約が並びます。",
    };
  }

  // 予約を申請できるのは有効な団体だけ (COND-006)
  if (!groups.some((group) => group.status === GroupStatus.Enabled)) {
    return {
      title: "まだ予約を申請できません",
      description:
        "所属している団体が事務局に有効化されていません。有効化されると予約を申請できるようになります。",
    };
  }

  return {
    title: "これからの予約はありません",
    description: "施設・設備を使う予定ができたら、事務局へ仮予約を申請してください。",
  };
};

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ルート単位のエラー画面がないと、root.tsx の英語の共通エラー画面が出てしまう。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "ページが見つかりません" : "予約を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "URL が間違っている可能性があります。"
              : "時間をおいて、もう一度お試しください。"}
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
