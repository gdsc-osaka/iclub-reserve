import { AppArea } from "~/lib/app-area";

import type { Route } from "./+types/route";
import { redirectToNewReservationCalendar } from "./new-reservation-entry.server";

/**
 * 利用者の画面の予約申請の入口（ADR-014 決定 10）。中身は `redirectToNewReservationCalendar`。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return redirectToNewReservationCalendar({ request, context }, AppArea.User);
}

/**
 * 外枠（app-layout）の下の画面として扱われるようにするための default コンポーネント。
 *
 * React Router は default のコンポーネントが無いルートを resource route（データだけを返すルート）
 * として扱うため、外枠の共通レイアウトが適用されなくなる。
 * ローダーで常に転送されるためこの画面が描画されることはないが、ほかの画面と同じ扱いのルートとして残す。
 */
export default function NewReservation() {
  return null;
}
