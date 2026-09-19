import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse, Link } from "react-router";

import { ReservationList } from "~/components/reservation/reservation-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { getReservationListUseCase } from "~/usecases/reservation/get-reservation-list";
import type { Route } from "./+types/route";
import { parseReservationListParams } from "./query-params";

export function meta(_: Route.MetaArgs) {
  return [{ title: "予約 | iclub-reserve" }];
}

/**
 * 予約一覧画面（SCR-003）のローダー。
 *
 * 自分が所属している団体の予約のみを取得して表示する。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const now = new Date();
  const url = new URL(request.url);
  const params = parseReservationListParams(url.searchParams, "own");

  const db = createDb(env.DB);
  const result = await getReservationListUseCase(
    {
      reservationListQuery: createReservationListQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      scope: "own",
      groupId: params.group,
      status: params.status,
      period: params.period,
      facilityId: params.facility,
      now,
    },
  );

  if (result.isErr()) {
    throw data({ message: result.error.message }, { status: 500 });
  }

  return {
    result: result.value,
    params,
    now,
  };
}

export default function ReservationListRoute({ loaderData }: Route.ComponentProps) {
  const { result, params, now } = loaderData;

  return <ReservationList result={result} params={params} scope="own" now={new Date(now)} />;
}

/**
 * 例外発生時の ErrorBoundary。
 *
 * 日本語の案内メッセージを表示する。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isForbidden ? "アクセス権限がありません" : "予約一覧を表示できません"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isForbidden
              ? "この画面を表示する権限がありません。"
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
