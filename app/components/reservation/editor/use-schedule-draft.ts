import { useState, type Dispatch, type SetStateAction } from "react";

import { ReservationStatus } from "~/domain/reservation";
import type {
  ReservationFormFacility,
  ReservationFormReservation,
} from "~/query/reservation/reservation-form";

import {
  findOverlapping,
  toBlockedSlots,
  toPastSlots,
  toTimelineReservations,
  type SlotRange,
  type TimelineReservation,
} from "./reservation-slots";

/**
 * 施設と時間帯の選びかけの状態と、そこから計算できるものをまとめたもの。
 *
 * 施設・時間帯を選ぶ部品（タイムライン・時刻の欄・重なりの警告など）は
 * どれもこれを受け取る。部品ごとに同じ計算を書き写さないため。
 */
export interface ScheduleDraft {
  /** 表示している日（日本時間のその日のどこかを指す Date） */
  readonly day: Date;
  /** ローダーが読んだ現在時刻 */
  readonly now: Date;
  /** 選んでいる施設・設備 */
  readonly facility: ReservationFormFacility;
  readonly setFacilityId: (facilityId: string) => void;
  /** 選んでいる時間帯。まだ選んでいなければ null */
  readonly range: SlotRange | null;
  readonly setRange: Dispatch<SetStateAction<SlotRange | null>>;
  /** その日・その施設に入っている予約 */
  readonly items: readonly TimelineReservation[];
  /** 承認済みの予約で塞がっている枠（COND-001） */
  readonly blockedSlots: ReadonlySet<number>;
  /** すでに過ぎてしまった枠 */
  readonly pastSlots: ReadonlySet<number>;
  /** 選んでいる時間帯と重なる承認済みの予約。1 件でもあれば申請できない（COND-001） */
  readonly approvedConflicts: readonly TimelineReservation[];
  /** 選んでいる時間帯と重なる仮予約。重ねて申請はできるが、その旨を伝える */
  readonly provisionalConflicts: readonly TimelineReservation[];
}

/**
 * 施設と時間帯の選びかけの状態を持つ。
 *
 * 仮予約の申請（SCR-002）で使い、予約の編集（UC-017 / UC-005）でも同じものを使う想定。
 * 日付は状態に持たない。日付を変えることはその日の予約を読み直すことなので、
 * URL（＝ローダー）が持つものを `day` として受け取る。
 *
 * `facilities` は 1 件以上あること。1 件も無いときは、呼び出し側が
 * フォームを出さずに「申請できない理由」を出す。
 */
export function useScheduleDraft({
  facilities,
  reservations,
  day,
  now,
  initialFacilityId,
  initialRange,
}: Readonly<{
  facilities: readonly ReservationFormFacility[];
  /** 表示中の日に入っている予約。施設をまたいで入っている */
  reservations: readonly ReservationFormReservation[];
  day: Date;
  now: Date;
  initialFacilityId: string;
  initialRange: SlotRange | null;
}>): ScheduleDraft {
  const [facilityId, setFacilityId] = useState(initialFacilityId);
  const [range, setRange] = useState<SlotRange | null>(initialRange);

  // 無い施設を指していたら先頭に戻す。一覧は 1 件以上ある前提
  const facility = facilities.find((item) => item.id === facilityId) ?? facilities[0];

  const items = toTimelineReservations(reservations, facility.id, day);
  const overlapping = range === null ? [] : findOverlapping(items, range);

  return {
    day,
    now,
    facility,
    setFacilityId,
    range,
    setRange,
    items,
    blockedSlots: toBlockedSlots(items),
    pastSlots: toPastSlots(day, now),
    approvedConflicts: overlapping.filter(
      (item) => item.reservation.status === ReservationStatus.Approved,
    ),
    provisionalConflicts: overlapping.filter(
      (item) => item.reservation.status === ReservationStatus.Provisional,
    ),
  };
}
