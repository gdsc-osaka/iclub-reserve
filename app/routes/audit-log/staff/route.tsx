import { env } from "cloudflare:workers";
import type { FormEvent, ReactNode } from "react";
import { Form, isRouteErrorResponse, Link, useNavigate } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AuditLogTargetType,
  auditLogActionLabel,
  auditLogTargetTypeLabel,
} from "~/domain/audit-log";
import { createAuditLogSearchQuery } from "~/infra/audit-log/audit-log-search-query";
import { createDb } from "~/infra/db";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatDateTime } from "~/lib/date";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { searchAuditLogsUseCase } from "~/usecases/audit-log/search-audit-logs";
import { formatChanges } from "./format-changes";
import {
  parseAuditLogSearchParams,
  toAuditLogSearchPath,
  type ParsedAuditLogSearchParams,
} from "./query-params";
import type { AuditLogSearchItem, AuditLogSearchResult } from "~/query/audit-log/audit-log-search";
import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "操作履歴 | iclub-reserve" }];
}

/**
 * 事務局向け操作履歴一覧画面（SCR-018）のローダー。
 *
 * 事務局スタッフのみがアクセス可能。非スタッフには 403 を返す（COND-009・COND-012(1)）。
 * 事務局判定はルートで先に行わず、ユースケースに任せる（ADR-004 決定 9）。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const url = new URL(request.url);
  const params = parseAuditLogSearchParams(url.searchParams);

  const db = createDb(env.DB);
  const result = await searchAuditLogsUseCase(
    {
      auditLogSearchQuery: createAuditLogSearchQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      filter: params.filter,
      page: params.page,
    },
  );

  if (result.isErr()) {
    // 事務局でなければ 403、DB の失敗は 500 になる。どちらもログに残る
    throw queryErrorResponse({ where: "staff.auditLog.loader", userId: user.id }, result.error);
  }

  return {
    result: result.value,
    params,
  };
}

/** 対象の画面へのリンク。行き先が無い（参照先が消えた・画面が無い）ときは文字だけにする */
function TargetLink({
  to,
  children,
}: {
  readonly to: string | null;
  readonly children: ReactNode;
}) {
  if (to === null) {
    return <span className="text-muted-foreground">{children}</span>;
  }
  return (
    <Link to={to} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

/**
 * 記録の対象を、対象の種類に応じた表示とリンクで出す。
 *
 * 予約は予約詳細（SCR-005）、団体・メンバーシップ・招待は団体詳細（SCR-007）、
 * 施設/設備は施設の編集（SCR-009）へ移れるようにする。
 * 参照先が消えていて名前を引けないときは、開いても見つからないのでリンクを置かない。
 */
function TargetDisplay({ item }: { readonly item: AuditLogSearchItem }) {
  const groupName = item.groupName ?? "（削除された団体）";
  const groupPath =
    item.groupId !== null && item.groupName !== null ? `/groups/${item.groupId}` : null;

  switch (item.targetType) {
    case AuditLogTargetType.Reservation:
      return item.reservation === null ? (
        <TargetLink to={null}>予約</TargetLink>
      ) : (
        <TargetLink to={`/reservations/${item.targetId}`}>
          {item.reservation.facilityName} {formatDateTime(item.reservation.startAt)}
        </TargetLink>
      );
    case AuditLogTargetType.Group:
      return <TargetLink to={groupPath}>{groupName}</TargetLink>;
    case AuditLogTargetType.Membership:
      return <TargetLink to={groupPath}>{groupName} のメンバー</TargetLink>;
    case AuditLogTargetType.Invitation:
      return <TargetLink to={groupPath}>{groupName} への招待</TargetLink>;
    case AuditLogTargetType.Facility:
      return (
        <TargetLink to={item.facilityName === null ? null : `/staff/facilities/${item.targetId}`}>
          {item.facilityName ?? "（削除された施設）"}
        </TargetLink>
      );
    case AuditLogTargetType.StaffRole:
      // 事務局管理画面（SCR-019）はまだ無いので、リンクは置かない。SCR-019 を作るときに足す
      return <TargetLink to={null}>事務局権限</TargetLink>;
  }
}

/**
 * 絞り込み条件入力フォーム。
 */
function FilterForm({
  params,
  groups,
  actors,
}: {
  readonly params: ParsedAuditLogSearchParams;
  readonly groups: AuditLogSearchResult["groups"];
  readonly actors: AuditLogSearchResult["actors"];
}) {
  const navigate = useNavigate();

  /*
   * そのまま GET で送ると「すべて」や空の期間まで `?type=all&from=` のように URL に載るので、
   * フォームの値を一度読み直し、既定値を省いた URL を組み立て直して移る。
   * page はフォームに含めないので、絞り込むと 1 ページ目に戻る。
   * JavaScript が動かないときは、ふつうの GET の送信になる（読み取り側は "all" も空も既定値として扱う）。
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") search.append(key, value);
    }
    void navigate(toAuditLogSearchPath(parseAuditLogSearchParams(search)));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">絞り込み条件</CardTitle>
      </CardHeader>
      <CardContent>
        {/*
         * 入力欄は defaultValue で初期値を入れているだけなので、URL が変わっても（「条件をクリア」など）
         * 表示が古いまま残る。条件ごとに key を変えて作り直し、いまの URL の条件を映す。
         */}
        <Form
          key={toAuditLogSearchPath({ ...params, page: 1 })}
          method="get"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* 対象の種類 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-type">対象の種類</Label>
              <Select name="type" defaultValue={params.type ?? "all"}>
                <SelectTrigger id="filter-type" className="w-full">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">すべて</SelectItem>
                    {Object.values(AuditLogTargetType).map((targetType) => (
                      <SelectItem key={targetType} value={targetType}>
                        {auditLogTargetTypeLabel[targetType]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* 団体 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-group">団体</Label>
              <Select name="group" defaultValue={params.group ?? "all"}>
                <SelectTrigger id="filter-group" className="w-full">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">すべて</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* 操作者 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-actor">操作者</Label>
              <Select name="actor" defaultValue={params.actor ?? "all"}>
                <SelectTrigger id="filter-actor" className="w-full">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">すべて</SelectItem>
                    {actors.map((actor) => (
                      <SelectItem key={actor.id} value={actor.id}>
                        {actor.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* 期間: 開始日 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-from">期間（開始日）</Label>
              <Input type="date" id="filter-from" name="from" defaultValue={params.from ?? ""} />
            </div>

            {/* 期間: 終了日 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-to">期間（終了日）</Label>
              <Input type="date" id="filter-to" name="to" defaultValue={params.to ?? ""} />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit">絞り込む</Button>
            <Link
              to="/staff/audit-log"
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              条件をクリア
            </Link>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function StaffAuditLogRoute({ loaderData }: Route.ComponentProps) {
  const { result, params } = loaderData;
  const { items, hasNextPage, groups, actors, userNames, facilityNames } = result;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">操作履歴</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          システム内で行われたすべての変更操作の履歴を新しい順に確認できます。
        </p>
      </div>

      <FilterForm params={params} groups={groups} actors={actors} />

      {/* 履歴は表ではなく行のリストにして、幅 320px のスマホでも横スクロールさせない */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          条件に合う操作履歴はありません。
        </div>
      ) : (
        <ol aria-label="操作履歴" className="flex flex-col gap-3">
          {items.map((item) => {
            const formattedChanges = formatChanges(item.changes, {
              targetType: item.targetType,
              userNames,
              facilityNames,
            });

            return (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3">
                    {/* ヘッダー行: 日時・操作者・権限 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs text-muted-foreground sm:text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {item.actorName ?? "（削除されたユーザー）"}
                        </span>
                        {item.actedAsStaff && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            事務局権限
                          </Badge>
                        )}
                      </div>
                      <time dateTime={item.occurredAt.toISOString()}>
                        {formatDateTime(item.occurredAt)}
                      </time>
                    </div>

                    {/* 対象の種類・操作・対象資源 */}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline">{auditLogTargetTypeLabel[item.targetType]}</Badge>
                      <span className="font-semibold">{auditLogActionLabel[item.action]}</span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        |
                      </span>
                      <TargetDisplay item={item} />
                    </div>

                    {/* 変更内容のリスト */}
                    {formattedChanges.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {formattedChanges.map((change) => (
                          <span
                            key={change.key}
                            className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                          >
                            {change.displayText}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {/* ページ送りリンク */}
      <nav aria-label="ページ送り" className="flex items-center justify-between pt-2">
        <div>
          {params.page > 1 ? (
            <Link
              to={toAuditLogSearchPath({ ...params, page: params.page - 1 })}
              className="text-sm font-medium text-primary hover:underline"
            >
              ← 新しい記録
            </Link>
          ) : (
            <span />
          )}
        </div>
        <div>
          {hasNextPage && (
            <Link
              to={toAuditLogSearchPath({ ...params, page: params.page + 1 })}
              className="text-sm font-medium text-primary hover:underline"
            >
              古い記録 →
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}

/**
 * 403（非スタッフによるアクセス）および 500 エラーを日本語で案内する ErrorBoundary。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isForbidden ? "事務局スタッフ専用ページです" : "操作履歴を表示できません"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isForbidden
              ? "この画面は事務局アカウントでのみご利用いただけます。"
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
