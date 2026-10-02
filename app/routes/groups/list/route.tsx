import { env } from "cloudflare:workers";
import { Users } from "lucide-react";
import { Link } from "react-router";

import { toMyGroup } from "~/components/group/my-group";
import { MyGroupCard, NoGroupsCard } from "~/components/group/my-group-card";
import { PendingGroupsNotice } from "~/components/group/pending-groups-notice";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { listMyGroupsUseCase } from "~/usecases/user/list-my-groups";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "所属団体 | iclub-reserve" }];
}

/**
 * 所属団体一覧画面（SCR-008: 一般向け）のローダー。
 *
 * ログインユーザーが所属する団体の一覧（メンバー数つき）を取得する。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const db = createDb(env.DB);
  const groupsResult = await listMyGroupsUseCase(
    { userGroupListQuery: createUserGroupListQuery(db) },
    { actorUserId: user.id },
  );

  if (groupsResult.isErr()) {
    throw queryErrorResponse({ where: "groups.list.loader", userId: user.id }, groupsResult.error);
  }

  return {
    groups: groupsResult.value.map(toMyGroup),
  };
}

/**
 * 所属団体一覧画面のルートコンポーネント。
 */
export default function GroupListRoute({ loaderData }: Route.ComponentProps) {
  const { groups } = loaderData;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Users aria-hidden className="size-5" />
          所属団体
        </h1>
        <Button asChild size="sm">
          <Link to="/groups/new">団体を登録</Link>
        </Button>
      </div>

      <PendingGroupsNotice groups={groups} />

      {groups.length === 0 ? (
        <NoGroupsCard />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <li key={group.id}>
              <MyGroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * エラー発生時の案内画面。
 */
export function ErrorBoundary() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">所属団体を読み込めませんでした</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            時間をおいて、もう一度お試しください。繰り返し表示される場合は事務局へお問い合わせください。
          </p>
          <Link to="/" className="text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
