import type { OverlapResolutionCandidate } from "~/query/reservation/overlap-resolution";
import {
  formatMonthDayParts,
  formatTime,
  tokyoMinutesOfDay,
  toTokyoDateKey,
  toTokyoTimeKey,
} from "~/lib/date";

export interface OverlapTimelineBar {
  /** 軸の左端から帯の始まりまで（%） */
  readonly leftPercent: number;
  /** 帯の幅（%） */
  readonly widthPercent: number;
}

export interface OverlapTimeline {
  /** 軸の目盛り。正時ごと。`label` は「10:00」の形、`percent` は左端からの位置 */
  readonly ticks: readonly { readonly label: string; readonly percent: number }[];
  /** 予約の id ごとの帯 */
  readonly bars: ReadonlyMap<string, OverlapTimelineBar>;
}

/**
 * 重なる仮予約の時間帯の帯と、タイムラインの目盛りを計算する純粋関数（COND-031）。
 *
 * 画面の都合しか持たない計算なので、React から切り離して純粋な関数にしてある。
 */
export const toOverlapTimeline = (
  items: readonly Pick<OverlapResolutionCandidate, "id" | "startAt" | "endAt">[],
): OverlapTimeline => {
  if (items.length === 0) {
    return {
      ticks: [],
      bars: new Map(),
    };
  }

  // 各予約の日本時間での開始・終了分（その日の 0 時からの経過分）
  const itemRanges = items.map((item) => ({
    id: item.id,
    startMinutes: tokyoMinutesOfDay(item.startAt),
    endMinutes: tokyoMinutesOfDay(item.endAt),
  }));

  const minStartMinutes = Math.min(...itemRanges.map((r) => r.startMinutes));
  const maxEndMinutes = Math.max(...itemRanges.map((r) => r.endMinutes));

  // 軸は最も早い開始の正時（切り捨て）から、最も遅い終了の正時（切り上げ）まで
  const axisStartMinutes = Math.floor(minStartMinutes / 60) * 60;
  const axisEndMinutes = Math.ceil(maxEndMinutes / 60) * 60;
  const totalMinutes = axisEndMinutes - axisStartMinutes;

  if (totalMinutes <= 0) {
    return {
      ticks: [],
      bars: new Map(),
    };
  }

  /*
   * 目盛りの刻み幅を決める。
   * 軸が 6 時間（360 分）を超えるときは、正時すべてに目盛りを振ると
   * 目盛りの文字が近すぎて読めなくなるため、2 時間おき（120 分）にする。
   * 6 時間以下なら 1 時間おき（60 分）にする。
   */
  const totalHours = totalMinutes / 60;
  const stepMinutes = totalHours > 6 ? 120 : 60;

  const ticks: { label: string; percent: number }[] = [];
  for (let m = axisStartMinutes; m <= axisEndMinutes; m += stepMinutes) {
    ticks.push({
      label: toTokyoTimeKey(m),
      percent: ((m - axisStartMinutes) / totalMinutes) * 100,
    });
  }

  const bars = new Map<string, OverlapTimelineBar>();
  for (const range of itemRanges) {
    const leftPercent = ((range.startMinutes - axisStartMinutes) / totalMinutes) * 100;
    const widthPercent = ((range.endMinutes - range.startMinutes) / totalMinutes) * 100;
    bars.set(range.id, { leftPercent, widthPercent });
  }

  return { ticks, bars };
};

/**
 * まとまり全体の日付と時間帯を「11/12(木) 10:00 – 14:00」の形にする（COND-031）。
 *
 * 重なりの解決ダイアログの見出しと、事務局の予約一覧のまとまりの見出しで使う。
 * 日付の書き方は、予約一覧の行・操作のダイアログと同じ。重なる予約はどれも同じ日なので、最も早い開始の日を使う。
 * 予約が 1 件も無ければ null を返す（ダイアログが候補を読む前）。
 */
export const toOverlapPeriodLabel = (
  items: readonly Pick<OverlapResolutionCandidate, "startAt" | "endAt">[],
): string | null => {
  if (items.length === 0) return null;

  const startAt = new Date(Math.min(...items.map((item) => item.startAt.getTime())));
  const endAt = new Date(Math.max(...items.map((item) => item.endAt.getTime())));
  const [_, month, day] = toTokyoDateKey(startAt).split("-");
  const { weekday } = formatMonthDayParts(startAt);

  return `${Number(month)}/${Number(day)}(${weekday}) ${formatTime(startAt)} – ${formatTime(endAt)}`;
};
