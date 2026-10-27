import { AppArea } from "~/lib/app-area";

import type { Route } from "./+types/route";
import { ReservationEditEntryErrorBoundary } from "./reservation-edit-error-boundary";
import { loadReservationEditEntry } from "./reservation-edit-entry.server";

export function meta() {
  return [{ title: "予約の変更 | i-Club 予約システム" }];
}

/**
 * 利用者の画面の予約の変更の入口（UC-005 / UC-017）。中身は `loadReservationEditEntry`。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  return loadReservationEditEntry({ context, reservationId: params.reservationId }, AppArea.User);
}

/**
 * 外枠（app-layout）の下の画面として扱われるようにするための default コンポーネント。
 *
 * React Router は default のコンポーネントが無いルートを resource route（データだけを返すルート）
 * として扱うため、外枠の共通レイアウトが適用されなくなる。
 * ローダーで常に転送されるためこの画面が描画されることはないが、ほかの画面と同じ扱いのルートとして残す。
 */
export default function EditReservation() {
  return null;
}

/** 例外が起きたときに出す画面（`ReservationEditEntryErrorBoundary`） */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  return (
    <ReservationEditEntryErrorBoundary
      error={error}
      reservationId={params.reservationId}
      area={AppArea.User}
    />
  );
}
