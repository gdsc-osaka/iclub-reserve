import {
  toDayBlocks,
  type AvailabilityBlock,
  type AvailabilityDay,
} from "~/components/reservation/availability-week";
import {
  isRangeAvailable,
  toBlockedSlots,
  toConflicts,
  toPastSlots,
  type Conflicts,
} from "~/components/reservation/editor/reservation-slots";
import type { AvailabilityReservation } from "~/query/facility/facility-availability-calendar";

import type { CalendarDraft } from "./paths";

/** 仮の枠から求めた日時の状態 */
export interface DraftScheduleState {
  readonly dayBlocks: readonly AvailabilityBlock[];
  readonly blockedSlots: ReadonlySet<number>;
  readonly pastSlots: ReadonlySet<number>;
  /** カレンダーの 30 分の枠と同じ計算で、取れる時間帯か */
  readonly isAvailable: boolean;
  /** 開始時刻が過ぎているか（過ぎている場合は重なりより先に伝える） */
  readonly isStartPast: boolean;
  /** カレンダーの帯と同じ予約で数えた重なり */
  readonly conflicts: Conflicts<AvailabilityBlock> | null;
}

/**
 * 仮の枠・その日・予約・現在時刻から、日時の状態（予約のブロック・押せない枠・過ぎた枠・取れるか・重なり）を求める純粋な関数。
 *
 * 申請の欄と変更の欄の両方から使う。変更の欄は、変更する予約を除いた予約一覧を渡す。
 */
export const calculateDraftSchedule = ({
  draft,
  day,
  reservations,
  now,
}: {
  readonly draft: CalendarDraft;
  readonly day: AvailabilityDay;
  readonly reservations: readonly AvailabilityReservation[];
  readonly now: Date;
}): DraftScheduleState => {
  const dayBlocks = toDayBlocks(day, reservations);
  const blockedSlots = toBlockedSlots(dayBlocks);
  const pastSlots = toPastSlots(day.date, now);

  // カレンダーの 30 分の枠と同じ計算で、取れるかを決める
  const isAvailable =
    draft.range !== null && isRangeAvailable(draft.range, blockedSlots, pastSlots);

  // 開始が過ぎているなら、重なりより先にそれを伝える（選び直すしかないので）
  const isStartPast = draft.range !== null && pastSlots.has(draft.range.startMinutes);

  // 重なりは、カレンダーの帯と同じ予約で数える
  const conflicts = draft.range === null ? null : toConflicts(dayBlocks, draft.range);

  return {
    dayBlocks,
    blockedSlots,
    pastSlots,
    isAvailable,
    isStartPast,
    conflicts,
  };
};
