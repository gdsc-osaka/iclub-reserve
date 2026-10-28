import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { toDayBlocks, type AvailabilityDay } from "~/components/reservation/availability-week";
import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import type { AppArea } from "~/lib/app-area";
import { startOfTokyoDay, toTokyoDateKey } from "~/lib/date";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";
import type { ReservationEditTarget } from "~/usecases/reservation/get-reservation-edit-form";

import {
  parseCalendarSelection,
  toCalendarPath,
  toReservationDraft,
  type CalendarDraft,
  type CalendarSelection,
  type ParsedCalendarSelection,
} from "./paths";

/**
 * URL で開いているものを、読み込んだデータと照らし合わせる。開けないものは null にする。
 *
 * - 予約がデータに無い（却下された・別の施設の予約・ID を書き換えた）
 * - 仮の枠の日の予約を読み込んでいない
 * - 申請できない人の仮の枠（COND-006）
 * - 変更前の予約が無い・ID が違う・変更後の仮の枠の日の予約を読み込んでいない（ADR-014 決定 15）
 *
 * `days` は予約を読み込んだ日。カレンダーの 4 週間と、その外で読んだ仮の枠の日（ADR-014 決定 19）。
 */
export const toOpenSelection = (
  requested: ParsedCalendarSelection | null,
  reservations: readonly AvailabilityReservation[],
  days: readonly AvailabilityDay[],
  canApply: boolean,
  editReservation: ReservationEditTarget | null = null,
): CalendarSelection | null => {
  if (requested === null) return null;

  if (requested.kind === "reservation") {
    return reservations.some((item) => item.id === requested.reservationId) ? requested : null;
  }

  if (requested.kind === "edit") {
    if (editReservation === null || editReservation.id !== requested.reservationId) {
      return null;
    }
    const draft = requested.draft ?? toReservationDraft(editReservation);
    if (!days.some((day) => day.dateKey === draft.dateKey)) return null;
    return { kind: "edit", reservationId: requested.reservationId, draft };
  }

  if (!canApply) return null;
  return days.some((day) => day.dateKey === requested.draft.dateKey) ? requested : null;
};

/**
 * 変更の欄を開いているとき、変更する予約そのものを予約一覧から除く（ADR-014 決定 15）。
 *
 * 除かないと自分自身と重なってしまい、承認済みの予約の時間を少しずらすだけでも
 * 「承認済みの予約と重なっています」になってしまうため。
 * 変更を開いていないとき（`editingReservationId` が null）は、そのまま返す。
 */
export const excludeEditingReservation = <T extends { readonly id: string }>(
  reservations: readonly T[],
  editingReservationId: string | null,
): readonly T[] =>
  editingReservationId === null
    ? reservations
    : reservations.filter((reservation) => reservation.id !== editingReservationId);

/**
 * 開いているものの日と時間帯。カレンダーの見える範囲に入れるのに使う。
 *
 * 予約は帯と同じく、利用できる時間帯（9:00〜21:00）に切り詰めた位置にする。
 */
export const toRevealTarget = (
  selection: CalendarSelection | null,
  reservations: readonly AvailabilityReservation[],
): { readonly dateKey: string; readonly range: SlotRange | null } | null => {
  if (selection === null) return null;
  if (selection.kind === "draft" || selection.kind === "edit") return selection.draft;

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
 * 空き状況カレンダーで開いているもの（予約・仮の枠・変更）を URL から読み、開く・閉じる操作を返す（ADR-014 決定 8・15）。
 *
 * 開いているものを URL（`?reservation=`・`?draft=`・`?edit=`）に置くので、そのまま人に送れ、
 * 読み込み直しても同じものが開く。戻る操作で閉じられる。
 */
export function useCalendarSelection({
  area,
  facilityId,
  anchorKey,
  reservations,
  days,
  canApply,
  editReservation = null,
}: Readonly<{
  area: AppArea;
  /** いま見ている施設・設備の ID。まだ選んでいなければ null で、何も開かない（ADR-014 決定 20） */
  facilityId: string | null;
  /** 基準の日（URL の `date`）。開く・閉じるときもそのまま持ち回る */
  anchorKey: string;
  reservations: readonly AvailabilityReservation[];
  /** 予約を読み込んだ日。カレンダーの 4 週間と、その外で読んだ仮の枠の日（ADR-014 決定 19） */
  days: readonly AvailabilityDay[];
  canApply: boolean;
  /** ローダーが読んだ変更前の予約（変更を開いているときのみ） */
  editReservation?: ReservationEditTarget | null;
}>) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const requested = useMemo(() => parseCalendarSelection(searchParams), [searchParams]);
  const selection = useMemo(
    () =>
      facilityId === null
        ? null
        : toOpenSelection(requested, reservations, days, canApply, editReservation),
    [facilityId, requested, reservations, days, canApply, editReservation],
  );

  /** 開いているものを外した URL へ移る。履歴には積まない */
  const replaceWithoutSelection = () => {
    void navigate(toCalendarPath(area, facilityId, anchorKey), {
      replace: true,
      preventScrollReset: true,
      state: location.state,
    });
  };

  /*
   * 開いていたものがデータから消えた（却下されたなど）・開けない URL のときは、URL からも外す。
   * 施設を選ぶ前は外さない。URL の仮の枠は、施設を選んだ先へ引き継ぐため（ADR-014 決定 20）。
   */
  const hasSelectionParam =
    searchParams.has("reservation") || searchParams.has("draft") || searchParams.has("edit");
  useEffect(() => {
    if (facilityId !== null && hasSelectionParam && selection === null) replaceWithoutSelection();
  }, [facilityId, hasSelectionParam, selection]);

  /**
   * 予約か仮の枠か変更を開く。
   *
   * 閉じた状態から開くときだけ履歴に積む。開いたまま選び直すたびに積むと、
   * 戻る操作で閉じるまでの回数が増えてしまう。
   */
  const open = (
    next: CalendarSelection,
    nextAnchorKey = anchorKey,
    nextFacilityId = facilityId,
  ) => {
    const path = toCalendarPath(area, nextFacilityId, nextAnchorKey, next);
    if (selection === null) {
      void navigate(path, { preventScrollReset: true, state: openedInCalendarState });
    } else {
      void navigate(path, { replace: true, preventScrollReset: true, state: location.state });
    }
  };

  /**
   * その日を開くときの基準の日（date）。予約を読み込んだ日（days）なら今の基準の日のまま、
   * そうでなければその日を基準の日にして読み直す（ADR-014 決定 11）。
   */
  const anchorKeyFor = (dateKey: string): string =>
    days.some((day) => day.dateKey === dateKey) ? anchorKey : dateKey;

  return {
    selection,
    /**
     * 仮の枠を開く。変更を開いているなら、変更のまま変更後の仮の枠だけを替える。
     */
    openDraft: (draft: CalendarDraft) => {
      const next: CalendarSelection =
        selection?.kind === "edit"
          ? { kind: "edit", reservationId: selection.reservationId, draft }
          : { kind: "draft", draft };
      open(next, anchorKeyFor(draft.dateKey));
    },
    openReservation: (reservationId: string) => open({ kind: "reservation", reservationId }),
    /**
     * 予約の欄を、その予約の変更に替える（ADR-014 決定 15）。変更後の仮の枠は、今の日時から始める。
     *
     * 予約は読み込んだ 4 週間の中にあるので、基準の日は今のまま。
     */
    openEdit: (reservationId: string) => {
      const target = reservations.find((item) => item.id === reservationId);
      if (target === undefined) return;
      open({ kind: "edit", reservationId, draft: toReservationDraft(target) });
    },
    /**
     * 変更をやめて、変更前の予約の内容の欄へ戻る（ADR-014 決定 15）。
     *
     * 施設を切り替えていても、変更前の予約の施設へ戻す。予約はその施設のカレンダーにしか出ないため。
     */
    cancelEdit: () => {
      if (editReservation === null) return;
      open(
        { kind: "reservation", reservationId: editReservation.id },
        anchorKeyFor(toTokyoDateKey(editReservation.startAt)),
        editReservation.facilityId,
      );
    },
    /** 閉じる。カレンダーの中で開いたなら、戻る操作と同じく開く前の画面へ戻る */
    close: () => {
      if (isOpenedInCalendar(location.state)) void navigate(-1);
      else replaceWithoutSelection();
    },
  };
}

/** 欄で開いているものを開く・替える・閉じる操作（`useCalendarSelection` の戻り値から、開いているものを除いたもの） */
export type CalendarSelectionOps = Omit<ReturnType<typeof useCalendarSelection>, "selection">;
