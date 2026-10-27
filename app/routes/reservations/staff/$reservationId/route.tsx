import { AppArea } from "~/lib/app-area";
import {
  ReservationDetailErrorBoundary,
  ReservationDetailPage,
} from "~/routes/reservations/$reservationId/reservation-detail-page";
import {
  handleReservationDetailAction,
  loadReservationDetail,
} from "~/routes/reservations/$reservationId/reservation-detail.server";
import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "予約の詳細 | i-Club 予約システム" }];
}

/**
 * 事務局画面の予約詳細（SCR-005 / ADR-016 決定 10）。
 *
 * 画面の立場は事務局の画面（AppArea.Staff）として動作する（COND-030）。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadReservationDetail(
    { request, context, reservationId: params.reservationId },
    AppArea.Staff,
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleReservationDetailAction(
    { request, context, reservationId: params.reservationId },
    AppArea.Staff,
  );
}

export default function StaffReservationDetailRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <ReservationDetailPage loaderData={loaderData} actionData={actionData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ReservationDetailErrorBoundary error={error} area={AppArea.Staff} />;
}
