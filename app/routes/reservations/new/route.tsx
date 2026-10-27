import { redirect } from "react-router";

import { toTokyoDateKey } from "~/lib/date";

import type { Route } from "./+types/route";
import { toCalendarPathFromFormQuery } from "./paths";

/**
 * 予約申請の入口（ADR-014 決定 10）。
 *
 * 画面は持たず、受け取ったクエリ（施設・日付・開始時刻・終了時刻）を仮の枠に直して
 * 空き状況カレンダーへ転送する。ナビの入口、ダッシュボードのボタン、ブックマークしたリンクから
 * カレンダーの申請欄を直接開けるようにするため。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const todayKey = toTokyoDateKey(new Date());

  throw redirect(toCalendarPathFromFormQuery(url.searchParams, todayKey));
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
