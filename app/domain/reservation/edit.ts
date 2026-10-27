import { err, ok, type Result } from "neverthrow";

import { canAct } from "../membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  type Reservation,
  type ReservationDraft,
  type ReservationError,
} from ".";
import type { ReservationActor } from "./transition";

/*
 * 予約の内容の変更（UC-005 / UC-017）の判定をまとめたファイル。
 *
 * 状態変更（transition.ts）とは別にしている。あちらは「取り消す・承認する」といった
 * 操作そのものが遷移で、遷移先は操作で決まる。こちらは内容の変更が主で、
 * ステータスが動くかどうかは「どの項目を変えたか」の結果でしかない（COND-005）。
 *
 * 変えてよいか（誰が・いまの状態・開始前か）は canEditReservation に、
 * 変えた項目から何が起きるかは resolveEditOutcome に集めてある。
 * 入力そのものの検証（COND-021）は、申請と同じ validation.ts の validateReservationDraft を使う。
 *
 * transition.ts と同じく、このファイルは index.ts を参照するが、index.ts はこのファイルを参照しない。
 * 逆向きの参照を足すと循環 import になる。
 */

/**
 * 予約の内容のうち、団体が変えられる項目（REQ-007 / REQ-029）。
 *
 * 団体（groupId）は含めない。予約を別の団体へ付け替える操作は要件に無く、
 * 付け替えられると、所属していない団体の予約を作れてしまう。
 */
export type ReservationContent = ReservationDraft & { readonly facilityId: string };

export type ReservationContentField = keyof ReservationContent;

/**
 * 変えると再承認が要る項目（COND-005）。
 *
 * 真偽値の表にしているのは、変えられる項目を増やしたときに
 * 「再承認が要るか」を決めないと型エラーになるようにするため。
 */
export const reapprovalRequiredFields = {
  facilityId: true,
  startAt: true,
  endAt: true,
  headCount: false,
  note: false,
} as const satisfies Record<ReservationContentField, boolean>;

/**
 * 変えると、承認済みの予約との重なり（COND-001）を確かめ直す項目。
 *
 * いまは再承認が要る項目と同じだが、答えている問いが違うので表を分けてある。
 * あちらは「事務局に見せ直すか」、こちらは「その時間帯が空いているか」を問う。
 *
 * 使用人数・備考だけの変更では確かめない。仮予約どうしは重なってよいので、
 * 重なっていた別の仮予約が先に承認されると、残った仮予約は承認済みの予約と重なったままになる。
 * そこで確かめてしまうと、時間帯を変えていないのに備考すら直せなくなる。
 */
export const overlapCheckFields = {
  facilityId: true,
  startAt: true,
  endAt: true,
  headCount: false,
  note: false,
} as const satisfies Record<ReservationContentField, boolean>;

/**
 * 団体が変えると、申請し直したと見なす項目（INFO-001.requested_at）。
 *
 * 申請日時は「いまの施設・時間帯を申し込んだ日時」で、事務局が仮予約を先に申し込まれた順に
 * 並べるのに使う（UC-033）。作成日時のままにすると、先に別の時間帯で申請しておいて
 * 後から狙った時間帯へ動かすだけで、その時間帯に先に申し込んでいた団体より前に並んでしまう。
 *
 * 使用人数・備考は時間帯の取り合いに関わらないので、変えても申し込み直したことにはしない。
 * 更新日時で代わりにしないのはこのためで、備考を直しただけで後ろへ回ってしまう。
 *
 * いまは再承認が要る項目と同じだが、答えている問いが違うので表を分けてある。
 * 仮予約のまま時間帯を変えたときは、再承認は起きないが申請日時は変わる。
 */
export const rerequestFields = {
  facilityId: true,
  startAt: true,
  endAt: true,
  headCount: false,
  note: false,
} as const satisfies Record<ReservationContentField, boolean>;

/** 変更の結果、予約に何が起きるか（COND-005） */
export const ReservationEditOutcome = {
  /** 1 項目も変わっていない。書き込みも通知もしない */
  NoChange: "noChange",
  /** 仮予約のまま内容だけ変わる（UC-017 / BUC-005） */
  KeepProvisional: "keepProvisional",
  /** 承認済みのまま、使用人数・備考だけ変わる（UC-005 / BUC-004） */
  KeepApproved: "keepApproved",
  /** 承認済みの予約の施設・日時が変わり、仮予約に戻る（UC-005 / BUC-018） */
  Reapproval: "reapproval",
} as const;
export type ReservationEditOutcome =
  (typeof ReservationEditOutcome)[keyof typeof ReservationEditOutcome];

/** 実際に書き込みが起きる変更。以降の表はこれを網羅する */
export type AppliedReservationEdit = Exclude<
  ReservationEditOutcome,
  typeof ReservationEditOutcome.NoChange
>;

/** 変更後の予約ステータス（STATE-001 / COND-005） */
export const editTargetStatus: Record<AppliedReservationEdit, ReservationStatus> = {
  [ReservationEditOutcome.KeepProvisional]: ReservationStatus.Provisional,
  [ReservationEditOutcome.KeepApproved]: ReservationStatus.Approved,
  [ReservationEditOutcome.Reapproval]: ReservationStatus.Provisional,
};

/**
 * 内容を変えられるステータス（STATE-001）。
 *
 * 終了した予約（取り消し済み・却下済み・キャンセル済み・事務局キャンセル済み）は変えられない。
 * 変えられると、終わったはずの予約の時間帯が書き換わり、記録として残している意味がなくなる。
 */
export const editableStatuses: readonly ReservationStatus[] = [
  ReservationStatus.Provisional,
  ReservationStatus.Approved,
];

/**
 * 予約の内容を変えられる状態・時刻かを判定する（STATE-001）。
 *
 * 団体の変更（UC-005 / UC-017）と事務局の直接変更（UC-008）で共通して使う。
 */
export const ensureEditableReservation = (
  reservation: Pick<Reservation, "status" | "startAt">,
  now: Date,
): Result<void, ReservationError> => {
  if (!editableStatuses.includes(reservation.status)) {
    return err({
      code: ReservationErrorCode.InvalidTransition,
      message: `${reservation.status} の予約の内容は変えられない。`,
      userMessage: "終了した予約は変更できません。",
    });
  }

  if (reservation.startAt <= now) {
    return err({
      code: ReservationErrorCode.InvalidTransition,
      message: "開始日時を過ぎた予約の内容を変えようとした。",
      userMessage: "開始日時を過ぎた予約は変更できません。",
    });
  }

  return ok(undefined);
};

/**
 * その人がその予約の内容を変えてよいかを判定する（STATE-001 / COND-009）。
 *
 * 1. 誰が: 予約の団体のメンバー。役割は問わない（取り消し・キャンセルと同じ）。
 *    事務局の権限だけでは変えられない。事務局の変更は直接変更（UC-008）として別に用意する
 * 2. いまの状態: 仮予約か承認済み
 * 3. いつ: 開始日時より前。開始日時を過ぎた予約は、項目を問わず変えられない
 *
 * 3 について。使用人数や備考だけなら直せてもよさそうに見えるが、終わった利用の記録を
 * 後から書き換えられることになり、「誰がいつ何人で使ったか」をたどるという目的（GOAL-001）が崩れる。
 * 開始前の予約を過ぎた日時へ動かすことも、申請と同じ入力の規則（COND-021）で拒む。
 *
 * ユースケースでは入力の検証より先に呼ぶこと。変えられない予約に「時間帯を選び直してください」と
 * 返しても、選び直したところで結局は弾かれる。
 * 画面が変更の入り口を出すかどうかも、この関数で決めること。
 *
 * @param now 「開始日時を過ぎたか」の基準になる現在時刻
 */
export const canEditReservation = (
  reservation: Pick<Reservation, "status" | "startAt">,
  actor: ReservationActor,
  now: Date,
): Result<void, ReservationError> => {
  if (!canAct(reservationPermissions, actor, ReservationAction.Edit)) {
    return err({
      code: ReservationErrorCode.Forbidden,
      message: "予約の団体に所属していない人が、予約の内容を変えようとした。",
      userMessage: "所属している団体の予約のみ変更できます。",
    });
  }

  return ensureEditableReservation(reservation, now);
};

/**
 * 事務局がその予約の内容を直接変えてよいかを判定する（UC-008 / COND-009）。
 *
 * 1. 誰が: 事務局（EditDirect が許されている人）。
 * 2. いまの状態: 仮予約か承認済み
 * 3. いつ: 開始日時より前
 *
 * @param now 「開始日時を過ぎたか」の基準になる現在時刻
 */
export const canDirectEditReservation = (
  reservation: Pick<Reservation, "status" | "startAt">,
  actor: ReservationActor,
  now: Date,
): Result<void, ReservationError> => {
  if (!canAct(reservationPermissions, actor, ReservationAction.EditDirect)) {
    return err({
      code: ReservationErrorCode.Forbidden,
      message: "事務局でない人が、予約の内容を直接変えようとした。",
      userMessage: "予約の直接変更は、事務局のみ行えます。",
    });
  }

  return ensureEditableReservation(reservation, now);
};

/** 予約の内容の変更を、どちらの規則で行うか */
export const ReservationEditMode = {
  /** 団体の変更（UC-005 / UC-017）。承認済みの施設・日時を変えると仮予約に戻る */
  Group: "group",
  /** 事務局の直接変更（UC-008）。ステータスを変えない */
  Direct: "direct",
} as const;
export type ReservationEditMode = (typeof ReservationEditMode)[keyof typeof ReservationEditMode];

/**
 * 操作する人から、団体の変更（UC-005 / UC-017）か直接変更（UC-008）かを決める。
 *
 * 事務局の画面からの変更は直接変更、利用者の画面からは団体の変更（COND-030 の (2)）。
 *
 * どちらの規則で変更するかは、この関数だけで決めること。画面の「変更」の出し分け・
 * 変更画面の loader・action が別々に判定すると、開けた画面と保存の結果が食い違う。
 */
export const resolveEditMode = (actor: Pick<ReservationActor, "isStaff">): ReservationEditMode =>
  actor.isStaff ? ReservationEditMode.Direct : ReservationEditMode.Group;

/**
 * 操作する人（団体メンバーか事務局か）に応じて、予約の内容を変更できるかを判定する。
 *
 * 画面の「変更」ボタンの出し分けに使う。
 */
export const canChangeReservationContent = (
  reservation: Pick<Reservation, "status" | "startAt">,
  actor: ReservationActor,
  now: Date,
): Result<void, ReservationError> =>
  resolveEditMode(actor) === ReservationEditMode.Direct
    ? canDirectEditReservation(reservation, actor, now)
    : canEditReservation(reservation, actor, now);

/**
 * 変えた項目を取り出す。
 *
 * 日時は `===` だと同じ時刻でも別物と判定される（Date は参照で比べられる）。
 * ここを取り違えると、備考だけ直したつもりの保存が「日時の変更」と見なされ、
 * 承認済みの予約が毎回仮予約に戻ってしまう。
 */
export const changedContentFields = (
  before: ReservationContent,
  after: ReservationContent,
): ReadonlySet<ReservationContentField> => {
  const fields = Object.keys(reapprovalRequiredFields) as readonly ReservationContentField[];

  return new Set(
    fields.filter((field) => {
      const a = before[field];
      const b = after[field];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    }),
  );
};

/**
 * いまのステータスと変えた項目から、変更の結果を決める（COND-005）。
 *
 * 仮予約は、どの項目を変えても仮予約のまま（UC-017）。
 * 承認済みは、施設・日時を変えたときだけ仮予約に戻る（UC-005）。
 *
 * 終了した予約はここへ渡さないこと（canEditReservation が先に弾く）。
 */
export const resolveEditOutcome = (
  currentStatus: ReservationStatus,
  changed: ReadonlySet<ReservationContentField>,
): ReservationEditOutcome => {
  if (changed.size === 0) return ReservationEditOutcome.NoChange;

  if (currentStatus !== ReservationStatus.Approved) {
    return ReservationEditOutcome.KeepProvisional;
  }

  const needsReapproval = [...changed].some((field) => reapprovalRequiredFields[field]);

  return needsReapproval ? ReservationEditOutcome.Reapproval : ReservationEditOutcome.KeepApproved;
};

export type DirectReservationEditOutcome =
  | typeof ReservationEditOutcome.NoChange
  | typeof ReservationEditOutcome.KeepApproved
  | typeof ReservationEditOutcome.KeepProvisional;

/**
 * 事務局による直接変更の結果を決める（UC-008）。
 *
 * 承認済みは施設・日時を変えても承認済みのまま（KeepApproved。再承認は不要）。
 * 仮予約は仮予約のまま（KeepProvisional）。
 * 1 項目も変えていなければ NoChange。
 */
export const resolveDirectEditOutcome = (
  currentStatus: ReservationStatus,
  changed: ReadonlySet<ReservationContentField>,
): DirectReservationEditOutcome => {
  if (changed.size === 0) return ReservationEditOutcome.NoChange;

  return currentStatus === ReservationStatus.Approved
    ? ReservationEditOutcome.KeepApproved
    : ReservationEditOutcome.KeepProvisional;
};

/** 変えた項目から、承認済みの予約との重なり（COND-001）を確かめ直すかを決める */
export const requiresOverlapCheck = (changed: ReadonlySet<ReservationContentField>): boolean =>
  [...changed].some((field) => overlapCheckFields[field]);

/** 申請日時を決めるのに使う、施設と時間帯 */
type ReservationSlot = Pick<ReservationContent, "facilityId" | "startAt" | "endAt">;

/**
 * 同じ施設のまま、時間帯を縮めただけか（変更後の時間帯が変更前の時間帯に収まるか）。
 */
const isNarrowedWithin = (before: ReservationSlot, after: ReservationSlot): boolean =>
  after.facilityId === before.facilityId &&
  after.startAt.getTime() >= before.startAt.getTime() &&
  after.endAt.getTime() <= before.endAt.getTime();

/**
 * 団体の変更（UC-005 / UC-017）のあとの申請日時を決める（INFO-001.requested_at）。
 *
 * - 施設・日時を変えたら、変えた日時（now）に置き換える。ステータスは見ない。
 *   仮予約のまま時間帯を変えたときも、申し込み直したことになる
 * - ただし、同じ施設で時間帯を縮めただけなら今のまま。縮めた後の時間帯は、もとの申請の時点で
 *   すでに申し込んでいた範囲なので、先に申し込んだように見せかけることにはならない。
 *   ほかの申請と重ならないよう時間帯を譲った団体が、順番まで失うのを避ける
 * - 使用人数・備考だけなら今のまま
 *
 * 事務局の直接変更（UC-008）では呼ばず、申請日時を引き継ぐ。事務局が動かした時間帯は、
 * 団体が申し込み直したものではないため。
 *
 * @param now 変更した日時。申し込み直したときの申請日時になる
 */
export const resolveRequestedAtAfterEdit = (
  before: ReservationSlot & { readonly requestedAt: Date },
  after: ReservationSlot,
  changed: ReadonlySet<ReservationContentField>,
  now: Date,
): Date => {
  const rerequested = [...changed].some((field) => rerequestFields[field]);

  if (!rerequested || isNarrowedWithin(before, after)) return before.requestedAt;

  return now;
};
