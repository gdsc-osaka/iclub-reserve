import { AppArea } from "~/lib/app-area";
import { ReservationEditEntryErrorBoundary } from "~/routes/reservations/$reservationId/edit/reservation-edit-error-boundary";
import { loadReservationEditEntry } from "~/routes/reservations/$reservationId/edit/reservation-edit-entry.server";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "予約の変更 | i-Club 予約システム" }];
}

/**
 * 事務局の画面の予約の変更の入口（UC-008 / ADR-016 決定 10）。中身は `loadReservationEditEntry`。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  return loadReservationEditEntry({ context, reservationId: params.reservationId }, AppArea.Staff);
}

/** 利用者の画面の入口（`app/routes/reservations/$reservationId/edit/route.tsx`）と同じく、外枠の下の画面として扱わせるための default コンポーネント */
export default function StaffEditReservation() {
  return null;
}

/** 例外が起きたときに出す画面（`ReservationEditEntryErrorBoundary`） */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  return (
    <ReservationEditEntryErrorBoundary
      error={error}
      reservationId={params.reservationId}
      area={AppArea.Staff}
    />
  );
}
