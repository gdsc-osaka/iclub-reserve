import { isRouteErrorResponse, Link } from "react-router";

import { GroupStatusBadge } from "~/components/group/group-status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { type AppArea, toAreaDashboardPath } from "~/lib/app-area";

import type { GroupActionData } from "./action-data";
import { GroupAuditLogCard } from "./group-audit-log-card";
import { GroupCalendarFeedCard } from "./group-calendar-feed-card";
import type { loadGroupDetail } from "./group-detail.server";
import { GroupInfoCard } from "./group-info-card";
import { GroupInvitationCard } from "./group-invitation-card";
import { GroupMemberCard } from "./group-member-card";

export type GroupDetailLoaderData = Awaited<ReturnType<typeof loadGroupDetail>>;

/** 画面の題。団体を取得できなかったとき（エラー画面）は loaderData が undefined になる */
export const toGroupDetailTitle = (loaderData: GroupDetailLoaderData | undefined): string =>
  loaderData?.view
    ? `${loaderData.view.group.name} | i-Club 予約システム`
    : "団体情報 | i-Club 予約システム";

/**
 * 団体管理画面（SCR-007）。利用者の画面と事務局の画面のルートが共有する（ADR-016 決定 10）。
 *
 * 団体の基本情報、所属メンバー一覧、および承諾待ちの招待（管理者・事務局のみ）を表示する。
 */
export function GroupDetailPage({
  loaderData,
  actionData,
}: {
  readonly loaderData: GroupDetailLoaderData;
  readonly actionData?: GroupActionData;
}) {
  const { view, now, currentUserId, isStaff, appBaseUrl } = loaderData;
  const nowDate = new Date(now);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:py-10">
      {/* ページ見出し */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {view.group.name}
          </h1>
          <GroupStatusBadge status={view.group.status} />
        </div>
      </div>

      {/* 団体情報カード */}
      <GroupInfoCard
        group={view.group}
        canManage={view.canManage}
        nameForm={actionData?.section === "name" ? actionData : null}
      />

      {/* カレンダー購読カード（所属している人にだけ表示。事務局でも所属していなければ出さない） */}
      {view.isMember && (
        <GroupCalendarFeedCard
          calendarFeed={view.calendarFeed}
          appBaseUrl={appBaseUrl}
          error={actionData?.section === "calendar-feed" ? actionData.formError : null}
        />
      )}

      {/* メンバーカード */}
      <GroupMemberCard
        view={view}
        currentUserId={currentUserId}
        error={actionData?.section === "members" ? actionData.formError : null}
      />

      {/* 承諾待ちの招待カード（管理者・事務局にだけ表示） */}
      {view.canManage && (
        <GroupInvitationCard
          invitations={view.invitations}
          now={nowDate}
          inviteForm={actionData?.section === "invite" ? actionData : null}
          error={actionData?.section === "invitations" ? actionData.formError : null}
        />
      )}

      {/* 操作履歴カード（管理者・事務局にだけ表示） */}
      {view.canManage && (
        <GroupAuditLogCard groupId={view.group.id} auditLogs={view.auditLogs} isStaff={isStaff} />
      )}
    </main>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 404 / 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * COND-011（存在の秘匿）に基づき、404 時は所属有無を問わず存在しない場合と同じ文言で案内する。
 * 戻り先は、開いていた画面のダッシュボードにする（ADR-016 決定 15）。
 */
export function GroupDetailErrorBoundary({
  error,
  area,
}: Readonly<{ error: unknown; area: AppArea }>) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "団体が見つかりません" : "団体情報を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "URL が間違っているか、指定された団体は存在しない可能性があります。"
              : "時間をおいて、もう一度お試しください。"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link
            to={toAreaDashboardPath(area)}
            className="text-sm text-primary underline underline-offset-4"
          >
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
