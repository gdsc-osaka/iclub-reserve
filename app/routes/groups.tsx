import { env } from "cloudflare:workers";
import { CalendarPlus, Hash, RefreshCw, ToggleLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { data, isRouteErrorResponse, Link } from "react-router";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { cn } from "~/lib/utils";
import { getGroupUseCase } from "~/usecases/group/get-group";

import type { Route } from "./+types/groups";
import { formatDateTime } from "~/lib/date";

export function meta({ loaderData: group }: Route.MetaArgs) {
  // グループを取得できなかったとき（エラー画面）は group が undefined になる
  return [{ title: group ? `${group.name} | iclub-reserve` : "グループ情報 | iclub-reserve" }];
}

/**
 * ページを表示する前に、サーバー側でグループ情報を取得。
 *
 * `export default function Group({ loaderData: group }: Route.ComponentProps)`
 * として取得できる。
 *
 * 取得できるのは自分が所属しているグループだけ。所属していないグループは
 * 存在を隠すため、権限がない旨ではなく 404 を返す。判定はユースケース側で行う。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const groupId = params.groupId;

  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const db = createDb(env.DB);

  const groupResult = await getGroupUseCase(
    {
      groupRepository: createGroupRepository(db),
      membershipRepository: createMembershipRepository(db),
    },
    { groupId, actorUserId: user.id },
  );

  if (groupResult.isErr()) {
    const error = groupResult.error;

    if (error.code === GroupErrorCode.GroupNotFound) {
      throw data({ message: "Group not found" }, { status: 404 });
    }

    // 不明なエラー
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return groupResult.value;
}

/** グループの詳細画面。グループ 1 件の登録情報をカードに並べて表示する。 */
export default function Group({ loaderData: group }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">{group.name}</CardTitle>
          <CardDescription>グループの登録情報</CardDescription>
          <CardAction>
            <GroupStatusBadge status={group.status} />
          </CardAction>
        </CardHeader>

        <CardContent>
          {/* 項目名と値の組み合わせなので、見出し付きのリスト（dl）で表す */}
          <dl className="grid gap-5 sm:grid-cols-2">
            <InfoItem icon={Hash} label="グループ ID">
              <span className="font-mono break-all">{group.id}</span>
            </InfoItem>

            <InfoItem icon={ToggleLeft} label="状態">
              {groupStatusLabel[group.status]}
            </InfoItem>

            <InfoItem icon={CalendarPlus} label="登録日時">
              {formatDateTime(group.createdAt)}
            </InfoItem>

            <InfoItem icon={RefreshCw} label="最終更新日時">
              {formatDateTime(group.updatedAt)}
            </InfoItem>
          </dl>
        </CardContent>
      </Card>
    </main>
  );
}

/** グループの状態を利用者向けの日本語にする。 */
const groupStatusLabel: Record<GroupStatus, string> = {
  [GroupStatus.Enabled]: "活動中",
  [GroupStatus.Pending]: "承認待ち",
  [GroupStatus.Disabled]: "停止中",
};

/** 状態ごとの配色。活動中だけを目立たせ、承認待ちは注意を促す色にする。 */
const groupStatusStyle: Record<GroupStatus, { readonly badge: string; readonly dot: string }> = {
  [GroupStatus.Enabled]: {
    badge: "bg-primary/10 text-primary ring-primary/20",
    dot: "bg-primary",
  },
  [GroupStatus.Pending]: {
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  [GroupStatus.Disabled]: {
    badge: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground",
  },
};

/** グループの状態をひと目で分かるようにする小さなラベル。 */
function GroupStatusBadge({ status }: Readonly<{ status: GroupStatus }>) {
  const style = groupStatusStyle[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        style.badge,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
      {groupStatusLabel[status]}
    </span>
  );
}

/** 「項目名 + 値」を 1 組だけ表示する。カード内の各情報はすべてこの形にそろえている。 */
function InfoItem({
  icon: Icon,
  label,
  children,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
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
            {isNotFound ? "グループが見つかりません" : "グループ情報を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "URL が間違っているか、このグループは削除された可能性があります。"
              : "時間をおいて、もう一度お試しください。"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link to="/" className="text-sm text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
