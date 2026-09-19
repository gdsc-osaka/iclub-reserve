import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse, Link, redirect } from "react-router";

import { ReservationList } from "~/components/reservation/reservation-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ReservationTransition } from "~/domain/reservation";
import { createDb } from "~/infra/db";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { toSamePagePath } from "~/lib/form-redirect";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";
import { getReservationListUseCase } from "~/usecases/reservation/get-reservation-list";
import type { Route } from "./+types/route";
import { toActionErrorMessage } from "./action-error";
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
    /*
     * 失敗の中身は画面へ出さない。利用者にできることは増えず、
     * こちらの内部の事情だけが伝わってしまう。詳しい原因はサーバー側のログに残る。
     */
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return {
    result: result.value,
    params,
    now,
  };
}

/**
 * 予約一覧画面からの状態変更アクション（取り消し・キャンセル）。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const reservationId = formData.get("reservationId");
  const reason = formData.get("reason");

  if (typeof reservationId !== "string" || !reservationId) {
    return { error: "予約が指定されていません。" };
  }

  const isAllowedTransition = (
    val: unknown,
  ): val is typeof ReservationTransition.Withdraw | typeof ReservationTransition.Cancel =>
    val === ReservationTransition.Withdraw || val === ReservationTransition.Cancel;

  if (!isAllowedTransition(intent)) {
    return { error: "不正な操作です。" };
  }

  const db = createDb(env.DB);
  const result = await changeReservationStatusUseCase(
    {
      reservationRepository: createReservationRepository(db),
      userGroupListQuery: createUserGroupListQuery(db),
    },
    {
      reservationId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      transition: intent as ReservationTransition,
      reason: typeof reason === "string" ? reason : null,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    return { error: toActionErrorMessage(result.error) };
  }

  return redirect(toSamePagePath(request));
}

export default function ReservationListRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { result, params, now } = loaderData;

  return (
    <ReservationList
      result={result}
      params={params}
      scope="own"
      now={new Date(now)}
      actionError={actionData?.error}
    />
  );
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
