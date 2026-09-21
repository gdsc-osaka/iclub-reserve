import { err, ok, type Result } from "neverthrow";

import { canPerform } from "../membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  type Reservation,
  type ReservationError,
} from ".";
import type { ReservationActor } from "./transition";

/*
 * 予約の内容編集（UC-005 / UC-017）の判定をまとめたファイル。
 *
 * 状態変更（transition.ts）とは別にしている。あちらは「取り消す・承認する」といった
 * 操作そのものが遷移で、遷移先は操作で決まる。こちらは内容の変更が主で、
 * ステータスが動くかどうかは「どの項目を変えたか」の結果でしかない（COND-005）。
 */

/** 編集できる項目（REQ-007 / REQ-029）。画面から届く値そのもの。 */
export interface ReservationEditInput {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
}

export type ReservationEditField = keyof ReservationEditInput;

/**
 * 変更すると再承認が必要になる項目（COND-005）。
 *
 * 真偽値の表にしているのは、編集できる項目を増やしたときに
 * 「再承認が要るか」を決めないと型エラーになるようにするため。
 * 団体（groupId）を編集対象に加えるなら、ここに 1 行足すことになる。
 */
export const reapprovalRequiredFields = {
  facilityId: true,
  startAt: true,
  endAt: true,
  headCount: false,
  note: false,
} as const satisfies Record<ReservationEditField, boolean>;

/** 編集の結果、予約に何が起きるか。 */
export const ReservationEditOutcome = {
  /** 1 項目も変わっていない。書き込みも通知もしない */
  NoChange: "noChange",
  /** 仮予約のまま内容だけ変わる（UC-017） */
  KeepProvisional: "keepProvisional",
  /** 承認済みのまま、使用人数・備考だけ変わる（BUC-004） */
  KeepApproved: "keepApproved",
  /** 承認済みの施設・日時が変わり、仮予約に戻る（BUC-018） */
  Reapproval: "reapproval",
} as const;
export type ReservationEditOutcome =
  (typeof ReservationEditOutcome)[keyof typeof ReservationEditOutcome];

/** 実際に書き込みが起きる編集。以降の表はこれを網羅する */
export type AppliedReservationEdit = Exclude<
  ReservationEditOutcome,
  typeof ReservationEditOutcome.NoChange
>;

/** 編集後の予約ステータス（STATE-001 / COND-005） */
export const editTargetStatus: Record<AppliedReservationEdit, ReservationStatus> = {
  [ReservationEditOutcome.KeepProvisional]: ReservationStatus.Provisional,
  [ReservationEditOutcome.KeepApproved]: ReservationStatus.Approved,
  [ReservationEditOutcome.Reapproval]: ReservationStatus.Provisional,
};

/**
 * 承認済みの予約との重なり（COND-001）を確かめるか。
 *
 * 使用人数・備考だけの変更では時間帯が動かないので確かめない。
 * 確かめてしまうと、更新前の自分自身と重なって必ず競合する。
 */
export const editRequiresOverlapCheck: Record<AppliedReservationEdit, boolean> = {
  [ReservationEditOutcome.KeepProvisional]: true,
  [ReservationEditOutcome.KeepApproved]: false,
  [ReservationEditOutcome.Reapproval]: true,
};

/**
 * 編集できる状態か・編集してよい人かを確かめる（STATE-001 / COND-009）。
 *
 * 開始日時を過ぎた予約は、項目を問わず編集できない。使用人数や備考だけなら
 * 直せてもよさそうに見えるが、終わった利用の記録を後から書き換えられることになり、
 * 「誰がいつ何人で使ったか」をたどるという目的（GOAL-001）が崩れる。
 */
export const canEdit = (
  reservation: Pick<Reservation, "status" | "startAt">,
  actor: ReservationActor,
  now: Date,
): Result<void, ReservationError> => {
  if (
    !actor.isStaff &&
    !canPerform(reservationPermissions, actor.membership, ReservationAction.Edit)
  ) {
    return err({
      code: ReservationErrorCode.ReservationForbidden,
      message: "所属している団体の予約のみ編集できます。",
    });
  }

  if (
    reservation.status !== ReservationStatus.Provisional &&
    reservation.status !== ReservationStatus.Approved
  ) {
    return err({
      code: ReservationErrorCode.ReservationInvalidTransition,
      message: "終了した予約は編集できません。",
    });
  }

  if (reservation.startAt < now) {
    return err({
      code: ReservationErrorCode.ReservationInvalidPeriod,
      message: "開始日時を過ぎた予約は編集できません。",
    });
  }

  return ok(undefined);
};

/**
 * 変更された項目を取り出す。
 *
 * 日時は `===` だと同じ時刻でも別物と判定される（Date は参照で比べられる）。
 * ここを取り違えると、備考だけ直したつもりの保存が「日時の変更」と見なされ、
 * 承認済みの予約が毎回仮予約に戻ってしまう。
 */
export const diffReservationEdit = (
  before: ReservationEditInput,
  after: ReservationEditInput,
): ReadonlySet<ReservationEditField> => {
  const fields = Object.keys(reapprovalRequiredFields) as readonly ReservationEditField[];

  return new Set(
    fields.filter((field) => {
      const a = before[field];
      const b = after[field];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    }),
  );
};

/**
 * 今のステータスと変更された項目から、編集の結果を決める（COND-005）。
 *
 * ご提示の 4 行の表は、ここでは 1 つの規則に畳んである。
 * 仮予約のときは「今のまま」と「仮予約」が同じ値になるためである。
 */
export const resolveEditOutcome = (
  currentStatus: ReservationStatus,
  changed: ReadonlySet<ReservationEditField>,
  isStaff: boolean,
): ReservationEditOutcome => {
  if (changed.size === 0) return ReservationEditOutcome.NoChange;

  if (currentStatus !== ReservationStatus.Approved) {
    return ReservationEditOutcome.KeepProvisional;
  }

  if (isStaff) return ReservationEditOutcome.KeepApproved;

  const needsReapproval = [...changed].some((field) => reapprovalRequiredFields[field]);

  return needsReapproval ? ReservationEditOutcome.Reapproval : ReservationEditOutcome.KeepApproved;
};