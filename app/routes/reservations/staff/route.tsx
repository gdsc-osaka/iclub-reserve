import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse, Link } from "react-router";

import { ReservationList } from "~/components/reservation/reservation-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { QueryErrorCode } from "~/query/error";
import { parseReservationListParams } from "~/routes/reservations/list/query-params";
import { getReservationListUseCase } from "~/usecases/reservation/get-reservation-list";
import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "予約の承認 | iclub-reserve" }];
}

/**
 * 事務局向け予約承認・管理画面（SCR-003）のローダー。
 *
 * 事務局スタッフのみがアクセス可能。非スタッフは 403 をスローする（COND-009）。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  // 事務局スタッフ以外はアクセス不可
  if (!user.is_staff) {
    throw data({ message: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const url = new URL(request.url);
  const params = parseReservationListParams(url.searchParams, "all");

  const db = createDb(env.DB);
  const result = await getReservationListUseCase(
    {
      reservationListQuery: createReservationListQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      scope: "all",
      groupId: null,
      status: params.status,
      period: params.period,
      facilityId: params.facility,
      now,
    },
  );

  if (result.isErr()) {
    if (result.error.code === QueryErrorCode.Forbidden) {
      throw data({ message: "Forbidden" }, { status: 403 });
    }
    throw data({ message: result.error.message }, { status: 500 });
  }

  return {
    result: result.value,
    params,
    now,
  };
}

export default function StaffReservationListRoute({ loaderData }: Route.ComponentProps) {
  const { result, params, now } = loaderData;

  return <ReservationList result={result} params={params} scope="all" now={new Date(now)} />;
}

/**
 * 例外発生時の ErrorBoundary。
 *
 * 403（非スタッフによるアクセス）および 500 エラーを日本語で案内する。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isForbidden ? "事務局スタッフ専用ページです" : "予約一覧を表示できません"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isForbidden
              ? "この画面は事務局アカウントでのみご利用いただけます。一般の予約一覧は「予約」メニューからご確認ください。"
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
