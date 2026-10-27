import type { AppArea } from "~/lib/app-area";
import { parseTokyoDateKey } from "~/lib/date";
import {
  parseDraftParam,
  toCalendarPath as toAvailabilityCalendarPath,
} from "~/routes/availability/paths";

/**
 * 予約申請フォーム（/reservations/new）のクエリパラメータから、空き状況カレンダーへの URL を組み立てる。
 *
 * 施設・日付・時刻を読み取り、仮の枠（draft）を開くカレンダーの URL を返す（ADR-014 決定 10）。
 * mode や created は無視する。
 */
export const toCalendarPathFromFormQuery = (
  area: AppArea,
  searchParams: URLSearchParams,
  todayKey: string,
): string => {
  const facilityParam = searchParams.get("facility")?.trim();
  const facilityId = facilityParam ? facilityParam : null;

  const dateParam = searchParams.get("date")?.trim();
  const dateKey = dateParam && parseTokyoDateKey(dateParam) !== null ? dateParam : todayKey;

  // 時刻の確かめ方（30 分の枠にある・開始が終了より前）は、カレンダーの `draft` と同じにする
  const start = searchParams.get("start")?.trim();
  const end = searchParams.get("end")?.trim();
  const timed = start && end ? parseDraftParam(`${dateKey}T${start}-${end}`) : null;

  return toAvailabilityCalendarPath(area, facilityId, dateKey, {
    kind: "draft",
    draft: { dateKey, range: timed?.range ?? null },
  });
};
