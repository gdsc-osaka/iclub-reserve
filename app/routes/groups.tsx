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
import { GroupErrorCode } from "~/domain/group";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
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
 */
export async function loader({ params }: Route.LoaderArgs) {
  const groupId = params.groupId;

  const db = createDb(env.DB);

  const groupResult = await getGroupUseCase(
    {
      groupRepository: createGroupRepository(db),
    },
    { groupId },
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
            <GroupStatusBadge isActive={group.isActive} />
          </CardAction>
        </CardHeader>

        <CardContent>
          {/* 項目名と値の組み合わせなので、見出し付きのリスト（dl）で表す */}
          <dl className="grid gap-5 sm:grid-cols-2">
            <InfoItem icon={Hash} label="グループ ID">
              <span className="font-mono break-all">{group.id}</span>
            </InfoItem>

            <InfoItem icon={ToggleLeft} label="状態">
              {group.isActive ? "活動中" : "停止中"}
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

/** 活動中かどうかをひと目で分かるようにする小さなラベル。 */
function GroupStatusBadge({ isActive }: Readonly<{ isActive: boolean }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        isActive
          ? "bg-primary/10 text-primary ring-primary/20"
          : "bg-muted text-muted-foreground ring-foreground/10",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", isActive ? "bg-primary" : "bg-muted-foreground")}
      />
      {isActive ? "活動中" : "停止中"}
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
