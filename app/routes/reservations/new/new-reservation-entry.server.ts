import { redirect, type RouterContextProvider } from "react-router";

import type { AppArea } from "~/lib/app-area";
import { toTokyoDateKey } from "~/lib/date";
import { requireAreaUser, toAreaWhere } from "~/routes/_shared/app-area.server";

import { toCalendarPathFromFormQuery } from "./paths";

/**
 * 予約申請（事務局の画面では直接作成）の入口（ADR-014 決定 10）。利用者の画面と事務局の画面のルートが、
 * どちらの画面かを渡して呼ぶ（ADR-016 決定 10）。
 *
 * 画面は持たず、受け取ったクエリ（施設・日付・開始時刻・終了時刻）を仮の枠に直して
 * 空き状況カレンダーへ転送する。ナビの入口、ダッシュボードのボタン、ブックマークしたリンクから
 * カレンダーの申請欄を直接開けるようにするため。
 * 転送先は開いている画面の空き状況で、欄の作り方はそこで決まる（ADR-016 決定 13）。
 */
export async function redirectToNewReservationCalendar(
  args: { readonly request: Request; readonly context: Readonly<RouterContextProvider> },
  area: AppArea,
): Promise<never> {
  // 事務局の画面は、事務局でなければ転送せずに 403 にする（ADR-016 決定 11）
  await requireAreaUser(args.context, area, toAreaWhere(area, "reservations.new.loader"));
  const url = new URL(args.request.url);
  const todayKey = toTokyoDateKey(new Date());

  throw redirect(toCalendarPathFromFormQuery(area, url.searchParams, todayKey));
}
