import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { toDayBlocks, type AvailabilityDay } from "~/components/reservation/availability-week";
import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import { startOfTokyoDay, toTokyoDateKey } from "~/lib/date";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import {
  parseCalendarSelection,
  toCalendarPath,
  type CalendarDraft,
  type CalendarSelection,
} from "./paths";

/**
 * URL で開いているものを、読み込んだデータと照らし合わせる。開けないものは null にする。
 *
 * - 予約がデータに無い（却下された・別の施設の予約・ID を書き換えた）
 * - 仮の枠の日が、読み込んだ 4 週間の中に無い
 * - 申請できない人の仮の枠（COND-006）
 */
export const toOpenSelection = (
  selection: CalendarSelection | null,
  reservations: readonly AvailabilityReservation[],
  days: readonly AvailabilityDay[],
  canApply: boolean,
): CalendarSelection | null => {
  if (selection === null) return null;

  if (selection.kind === "reservation") {
    return reservations.some((item) => item.id === selection.reservationId) ? selection : null;
  }

  if (!canApply) return null;
  return days.some((day) => day.dateKey === selection.draft.dateKey) ? selection : null;
};

/**
 * 開いているものの日と時間帯。カレンダーの見える範囲に入れるのに使う。
 *
 * 予約は帯と同じく、利用できる時間帯（9:00〜21:00）に切り詰めた位置にする。
 */
export const toRevealTarget = (
  selection: CalendarSelection | null,
  reservations: readonly AvailabilityReservation[],
): { readonly dateKey: string; readonly range: SlotRange } | null => {
  if (selection === null) return null;
  if (selection.kind === "draft") return selection.draft;

  const reservation = reservations.find((item) => item.id === selection.reservationId);
  if (reservation === undefined) return null;
  const [block] = toDayBlocks({ date: startOfTokyoDay(reservation.startAt) }, [reservation]);
  if (block === undefined) return null;
  return {
    dateKey: toTokyoDateKey(reservation.startAt),
    range: { startMinutes: block.startMinutes, endMinutes: block.endMinutes },
  };
};

/**
 * カレンダーの中で開いたことを示す、履歴の state の印。
 *
 * 閉じるときに、この印があれば 1 つ前の履歴（開く前の画面）へ戻る。
 * URL を直接開いたときは印が無いので、戻ると別の画面へ出てしまう。そのときは URL から外すだけにする。
 */
const openedInCalendarState = { calendarSelection: true };

const isOpenedInCalendar = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "calendarSelection" in state &&
  state.calendarSelection === true;

/**
 * 空き状況カレンダーで開いているもの（予約・仮の枠）を URL から読み、開く・閉じる操作を返す（ADR-014 決定 8）。
 *
 * 開いているものを URL（`?reservation=`・`?draft=`）に置くので、そのまま人に送れ、
 * 読み込み直しても同じものが開く。戻る操作で閉じられる。
 */
export function useCalendarSelection({
  facilityId,
  anchorKey,
  reservations,
  days,
  canApply,
}: Readonly<{
  facilityId: string;
  /** 基準の日（URL の `date`）。開く・閉じるときもそのまま持ち回る */
  anchorKey: string;
  reservations: readonly AvailabilityReservation[];
  days: readonly AvailabilityDay[];
  canApply: boolean;
}>) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const requested = useMemo(() => parseCalendarSelection(searchParams), [searchParams]);
  const selection = useMemo(
    () => toOpenSelection(requested, reservations, days, canApply),
    [requested, reservations, days, canApply],
  );

  /** 開いているものを外した URL へ移る。履歴には積まない */
  const replaceWithoutSelection = () => {
    void navigate(toCalendarPath(facilityId, anchorKey), {
      replace: true,
      preventScrollReset: true,
      state: location.state,
    });
  };

  // 開いていたものがデータから消えた（却下されたなど）・開けない URL のときは、URL からも外す
  const hasSelectionParam = searchParams.has("reservation") || searchParams.has("draft");
  useEffect(() => {
    if (hasSelectionParam && selection === null) replaceWithoutSelection();
  }, [hasSelectionParam, selection]);

  /**
   * 予約か仮の枠を開く。
   *
   * 閉じた状態から開くときだけ履歴に積む。開いたまま選び直すたびに積むと、
   * 戻る操作で閉じるまでの回数が増えてしまう。
   */
  const open = (next: CalendarSelection) => {
    const path = toCalendarPath(facilityId, anchorKey, next);
    if (selection === null) {
      void navigate(path, { preventScrollReset: true, state: openedInCalendarState });
    } else {
      void navigate(path, { replace: true, preventScrollReset: true, state: location.state });
    }
  };

  return {
    selection,
    openDraft: (draft: CalendarDraft) => open({ kind: "draft", draft }),
    openReservation: (reservationId: string) => open({ kind: "reservation", reservationId }),
    /** 閉じる。カレンダーの中で開いたなら、戻る操作と同じく開く前の画面へ戻る */
    close: () => {
      if (isOpenedInCalendar(location.state)) void navigate(-1);
      else replaceWithoutSelection();
    },
  };
}
