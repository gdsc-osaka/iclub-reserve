import { env } from "cloudflare:workers";
import { Calendar, CircleAlert, Plus, Wrench } from "lucide-react";
import { isRouteErrorResponse, Link } from "react-router";

import { FacilityStatusBadge } from "~/components/facility/facility-status-badge";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createFacilityManagementListQuery } from "~/infra/facility/facility-management-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import type { FacilityManagementItem } from "~/query/facility/facility-management-list";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { listFacilitiesForManagementUseCase } from "~/usecases/facility/list-facilities-for-management";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "施設の管理 | iclub-reserve" }];
}

/**
 * 事務局向け施設管理画面（SCR-009）のローダー。
 *
 * 事務局スタッフのみ閲覧可能（COND-009）。非スタッフはユースケースで Forbidden が返り、
 * 403 エラーレスポンスとしてログに残る。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const db = createDb(env.DB);
  const result = await listFacilitiesForManagementUseCase(
    { facilityManagementListQuery: createFacilityManagementListQuery(db) },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
    },
  );

  if (result.isErr()) {
    throw queryErrorResponse({ where: "staff.facilities.loader", userId: user.id }, result.error);
  }

  return {
    items: result.value,
  };
}

/**
 * 施設・設備の一覧（SCR-009）。
 *
 * 有効・無効の切り替えはここには置かず、各施設・設備の編集画面（`/staff/facilities/:facilityId`）で行う（UC-016）。
 * 滅多に行わない操作なので、毎回開く一覧に並べると押し間違えの元になるだけだから。
 */
export default function StaffFacilitiesPage({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-7xl mx-auto w-full">
      {/* 画面見出し */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">施設・設備の管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            事務局スタッフ向けに施設・設備の登録と編集を行います。有効・無効の切り替えは各施設・設備の編集画面で行います。
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/staff/facilities/new">
            <Plus className="size-4 mr-1.5" />
            施設を登録
          </Link>
        </Button>
      </div>

      {/* 施設一覧 */}
      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="flex flex-col items-center justify-center gap-3">
            <Wrench className="size-10 text-muted-foreground" />
            <CardTitle className="text-lg">登録された施設・設備はありません</CardTitle>
            <p className="text-sm text-muted-foreground">
              「施設を登録」ボタンから施設や設備を新規追加してください。
            </p>
            <Button asChild className="mt-2">
              <Link to="/staff/facilities/new">
                <Plus className="size-4 mr-1.5" />
                施設を登録
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((facility) => (
            <FacilityCard key={facility.id} facility={facility} />
          ))}
        </div>
      )}
    </div>
  );
}

function FacilityCard({ facility }: Readonly<{ facility: FacilityManagementItem }>) {
  return (
    <Card className="flex flex-col overflow-hidden">
      {/* サムネイル */}
      <div className="h-44 w-full bg-muted overflow-hidden relative">
        {facility.photoUrl ? (
          <img src={facility.photoUrl} alt={facility.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground/60">
            <Wrench className="size-12" />
          </div>
        )}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <FacilityStatusBadge isActive={facility.isActive} />
        </div>
      </div>

      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold leading-tight line-clamp-1">
            <Link
              to={`/staff/facilities/${facility.id}`}
              className="hover:underline focus-visible:underline"
            >
              {facility.name}
            </Link>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 flex-1 flex flex-col gap-2">
        <p className="text-sm text-muted-foreground line-clamp-2 min-h-10">
          {facility.description ?? "説明はありません。"}
        </p>
        <div className="flex items-center gap-2 mt-auto pt-2">
          {facility.hasGoogleCalendar && (
            <Badge variant="outline" className="text-xs gap-1 font-normal text-muted-foreground">
              <Calendar className="size-3" />
              カレンダー連携中
            </Badge>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 border-t flex items-center justify-between gap-2 bg-muted/20">
        <Button variant="outline" size="sm" asChild>
          <Link to={`/staff/facilities/${facility.id}`}>編集</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
        <CircleAlert className="size-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold">事務局スタッフ専用ページです</h1>
        <p className="text-muted-foreground mt-2 max-w-md">
          このページの閲覧には事務局スタッフの権限が必要です。アカウントをご確認ください。
        </p>
        <Button asChild className="mt-6">
          <Link to="/">ホームに戻る</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
      <CircleAlert className="size-12 text-destructive mb-4" />
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        施設情報の読み込みに失敗しました。時間をおいてもう一度お試しください。
      </p>
      <Button onClick={() => window.location.reload()} className="mt-6">
        再読み込み
      </Button>
    </div>
  );
}
