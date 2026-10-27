import { useState } from "react";

import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import type { UnlockArrangement } from "~/domain/reservation";

/** 解錠の手配を選んだ対象の施設・日・時間帯 */
type UnlockArrangementSchedule = Readonly<{
  facilityId: string;
  dateKey: string;
  range: SlotRange | null;
}>;

/**
 * 施設・日・時間帯を 1 つの文字列にまとめる。
 * 解錠の手配を選んだあとで、施設・日時が変わったかを見分けるのに使う。
 */
const toScheduleKey = ({ facilityId, dateKey, range }: UnlockArrangementSchedule): string =>
  [facilityId, dateKey, range?.startMinutes ?? "", range?.endMinutes ?? ""].join("|");

/**
 * 直接作成・直接変更のフォームで選んだ解錠の手配（COND-027）を持つフック。
 *
 * 解錠の手配は、そのときの施設・日時について選ぶもの。
 * 選んだあとで施設・日時を変えたら、選んだ値は使わずに未選択へ戻し、最後の施設・日時について
 * 選び直させる（直接変更で、保存済みの値を引き継がないのと同じ理由）。
 * そのために、選んだ値と、選んだときの施設・日時をまとめて持つ。
 *
 * 送って戻ってきたときは、送った値（`submitted`）を今の施設・日時について選んだものとして始める。
 *
 * @returns 選んでいる値（まだ選んでいないか、選んだあとで施設・日時が変わったなら null）と、選ぶ関数
 */
export function useUnlockArrangementChoice(
  schedule: UnlockArrangementSchedule,
  submitted: UnlockArrangement | null,
) {
  const scheduleKey = toScheduleKey(schedule);
  const [choice, setChoice] = useState<{
    readonly value: UnlockArrangement;
    readonly scheduleKey: string;
  } | null>(submitted === null ? null : { value: submitted, scheduleKey });

  const value = choice?.scheduleKey === scheduleKey ? choice.value : null;
  const select = (next: UnlockArrangement) => setChoice({ value: next, scheduleKey });

  return [value, select] as const;
}
