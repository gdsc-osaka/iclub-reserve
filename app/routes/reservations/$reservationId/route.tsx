import { AppArea } from "~/lib/app-area";
import type { Route } from "./+types/route";
import { ReservationDetailErrorBoundary, ReservationDetailPage } from "./reservation-detail-page";
import { handleReservationDetailAction, loadReservationDetail } from "./reservation-detail.server";

export function meta() {
  return [{ title: "予約の詳細 | i-Club 予約システム" }];
}

/**
 * 利用者画面の予約詳細（SCR-005）。
 *
 * 画面の立場は利用者の画面（AppArea.User）として動作する（COND-030）。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadReservationDetail(
    { request, context, reservationId: params.reservationId },
    AppArea.User,
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleReservationDetailAction(
    { request, context, reservationId: params.reservationId },
    AppArea.User,
  );
}

export default function ReservationDetailRoute({ loaderData, actionData }: Route.ComponentProps) {
  return <ReservationDetailPage loaderData={loaderData} actionData={actionData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ReservationDetailErrorBoundary error={error} area={AppArea.User} />;
}
