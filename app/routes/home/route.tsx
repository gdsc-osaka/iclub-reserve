import { env } from "cloudflare:workers";
import { CircleAlert, Clock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { GroupStatus } from "~/domain/group";
import { createDb } from "~/infra/db";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { listMyGroupsUseCase } from "~/usecases/user/list-my-groups";

import type { Route } from "./+types/route";
import { toDashboardGroup, type DashboardGroup } from "./dashboard-group";
import { MyGroupsSection } from "./my-groups-section";

export function meta(_: Route.MetaArgs) {
  return [{ title: "ダッシュボード | iclub-reserve" }];
}

/**
 * ダッシュボードに出すデータを取る。
 *
 * この画面はログイン後の行き先なので、一部が取れなくても開けるようにしている。
 * 団体の一覧が取れないときに 500 を返すと、ログインした人が
 * どこにも行けない状態になってしまう。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const groupsResult = await listMyGroupsUseCase(
    { userGroupListQuery: createUserGroupListQuery(createDb(env.DB)) },
    { actorUserId: user.id },
  );

  if (groupsResult.isErr()) {
    return { groups: [] as readonly DashboardGroup[], isGroupsUnavailable: true };
  }

  return { groups: groupsResult.value.map(toDashboardGroup), isGroupsUnavailable: false };
}

/**
 * ログイン後に最初に開く画面。
 *
 * 所属している団体を横断して、いま自分に関係することをまとめて出す。
 * 団体を切り替えて見る形にしていないのは、複数の団体を掛け持ちしている人が多く、
 * 切り替えを忘れたまま「予約が無い」と勘違いするのを避けたいため。
 *
 * NOTE: 「今後の予約」と「今週の空き状況」はここに並べる予定だが、
 * 予約と施設の読み取りがまだ無いので置いていない。
 * 中身の無いカードを先に並べても、見た人には何も分からない。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { groups, isGroupsUnavailable } = loaderData;
  const pendingGroups = groups.filter((group) => group.status === GroupStatus.Pending);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      {isGroupsUnavailable && <GroupsUnavailableAlert />}

      {pendingGroups.length > 0 && <PendingGroupsNotice groups={pendingGroups} />}

      <MyGroupsSection groups={groups} isUnavailable={isGroupsUnavailable} />
    </main>
  );
}

/** 団体の一覧を読めなかったときの案内。画面そのものは開けるので、ここだけで断る */
function GroupsUnavailableAlert() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>所属している団体を読み込めませんでした</AlertTitle>
      <AlertDescription>
        時間をおいて、画面を再読み込みしてください。
        繰り返し表示される場合は事務局にご連絡ください。
      </AlertDescription>
    </Alert>
  );
}

/**
 * 団体が承認待ちのあいだに出す案内。
 *
 * 承認待ちの団体からは予約を申請できない（COND-006）。
 * 理由を書かずに申請だけできない状態にすると、
 * 不具合だと思って何度も試すことになる。
 *
 * 画面全体ではなく団体ごとに出しているのは、
 * 複数の団体に所属していると団体ごとに状態が違うため。
 */
function PendingGroupsNotice({ groups }: Readonly<{ groups: readonly DashboardGroup[] }>) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <Clock aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>承認待ちの団体があります</AlertTitle>
      <AlertDescription>
        {groups.map((group) => group.name).join("、")}
        は事務局の承認を待っています。承認されるまで、この団体では予約を申請できません。
      </AlertDescription>
    </Alert>
  );
}
