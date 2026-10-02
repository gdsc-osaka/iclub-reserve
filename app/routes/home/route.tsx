import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";

import { toMyGroup, type MyGroup } from "~/components/group/my-group";
import { PendingGroupsNotice } from "~/components/group/pending-groups-notice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { createDb } from "~/infra/db";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { logQueryError } from "~/routes/_shared/query-error.server";
import { listMyGroupsUseCase } from "~/usecases/user/list-my-groups";

import type { Route } from "./+types/route";
import { MyGroupsSection } from "./my-groups-section";

export function meta() {
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
    /*
     * 画面は開けるようにするが、失敗そのものは残す。
     * ここで握りつぶすと、D1 の障害で団体が読めていないのか、
     * そもそも所属が無いのかを、あとから区別する手がかりが残らない。
     */
    logQueryError({ where: "home.loader", userId: user.id }, groupsResult.error);

    return { groups: [] as readonly MyGroup[], isGroupsUnavailable: true };
  }

  return { groups: groupsResult.value.map(toMyGroup), isGroupsUnavailable: false };
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      {isGroupsUnavailable && <GroupsUnavailableAlert />}

      {/* 承認待ちの団体がカードに出ていない 5 件目以降でも、ここには必ず名前が出る */}
      <PendingGroupsNotice groups={groups} />

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
