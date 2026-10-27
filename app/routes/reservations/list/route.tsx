import { env } from "cloudflare:workers";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import { ReservationList } from "~/components/reservation/reservation-list";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { AppArea } from "~/lib/app-area";
import { createUserGroupListQuery } from "~/query/user/user-group-list";
import { requireAreaUser } from "~/routes/_shared/app-area.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import { getReservationListUseCase } from "~/usecases/reservation/get-reservation-list";
import type { Route } from "./+types/route";
import { parseReservationListParams } from "./query-params";

export function meta() {
  return [{ title: "予約 | i-Club 予約システム" }];
}

/**
 * 予約一覧画面（SCR-003）のローダー。
 *
 * 自分が所属している団体の予約のみを取得して表示する。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, actsAsStaff } = await requireAreaUser(context, AppArea.User, "reservations.loader");
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
      isStaff: actsAsStaff,
      scope: "own",
      groupId: params.group,
      status: params.status,
      period: params.period,
      facilityId: params.facility,
      now,
    },
  );

  if (result.isErr()) {
    // 失敗の中身は画面へ出さず、ログにだけ残す。決めているのは表の側
    throw queryErrorResponse({ where: "reservations.loader", userId: user.id }, result.error);
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
  const { user, actsAsStaff } = await requireAreaUser(context, AppArea.User, "reservations.action");
  const formData = await request.formData();
  const intent = formData.get("intent");
  const reservationId = formData.get("reservationId");
  const reason = formData.get("reason");

  if (typeof reservationId !== "string" || !reservationId) {
    return { formError: "予約が指定されていません。" };
  }

  /*
   * この画面が出している操作だけを受け付ける。どれが事務局の操作かはドメインの表
   * （transitionAuthority）が決めるので、ここに操作名を書き並べない。
   * 操作そのものの可否（所属・役割・今の状態）はユースケースの canTransition が見る。
   */
  const transition = parseReservationTransition(intent);

  if (transition === null || isStaffTransition(transition)) {
    return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
  }

  const db = createDb(env.DB);
  // ログの where に操作の種類まで入れて、どの操作で失敗したかを絞り込めるようにする
  const where = `reservations.${transition}`;
  const result = await changeReservationStatus(db, request, user, {
    reservationId,
    transition,
    reason,
    unlockArrangement: formData.get("unlockArrangement"),
    message: formData.get("message"),
    now: new Date(),
    actsAsStaff,
    where,
  });

  if (result.isErr()) {
    // 一覧には欄が無いので、誤りはすべて一覧の上に出す
    return reservationActionErrors({ where, userId: user.id }, result.error);
  }

  /*
   * 操作のあとは、いま見ていた一覧へ戻す（同じ内容の再送信を防ぐ PRG）。
   * `.` は「いま表示しているルート」を指し、React Router が Location を
   * ルートのパスから解決する。そのため Single Fetch のデータ用 URL
   * （/reservations.data）を自分で元に戻す必要はない。
   *
   * 絞り込みのクエリは残す。操作のたびに外れると、一覧を見ていた場所を毎回探し直すことになる。
   */
  return redirect(`.${new URL(request.url).search}`);
}

export default function ReservationListRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { result, params, now } = loaderData;

  return (
    <ReservationList
      result={result}
      params={params}
      area={AppArea.User}
      now={new Date(now)}
      actionError={actionData?.formError}
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
