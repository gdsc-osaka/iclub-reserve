import { AppArea } from "~/lib/app-area";
import { redirectToNewReservationCalendar } from "~/routes/reservations/new/new-reservation-entry.server";

import type { Route } from "./+types/route";

/**
 * 事務局の画面の予約の直接作成の入口（UC-008 / ADR-016 決定 10）。中身は `redirectToNewReservationCalendar`。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return redirectToNewReservationCalendar({ request, context }, AppArea.Staff);
}

/** 利用者の画面の入口（`app/routes/reservations/new/route.tsx`）と同じく、外枠の下の画面として扱わせるための default コンポーネント */
export default function StaffNewReservation() {
  return null;
}
