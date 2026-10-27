import { err, ok, type Result } from "neverthrow";

import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  UnlockArrangement,
  type ReservationError,
} from ".";
import {
  ReservationEditOutcome,
  type AppliedReservationEdit,
  type ReservationContentField,
} from "./edit";

/*
 * 施設の解錠の手配（INFO-001 / STATE-004 / COND-027）をまとめたファイル。
 *
 * 「値の解釈」「検証」「表示用文言」「直接変更で選び直しが要るかの判定」
 * 「団体の変更後に手配をどう扱うかの判定」を集めてある。
 *
 * このファイルは index.ts を参照するが、index.ts はこのファイルを参照しない。
 * 逆向きの参照を足すと循環 import になり、どちらかのトップレベルの定数が
 * 未初期化のまま読まれて落ちる。
 */

/**
 * 施設の解錠の手配の選択肢ラベル（COND-027）。
 */
export const unlockArrangementLabel: Record<UnlockArrangement, string> = {
  [UnlockArrangement.Required]: "要手配",
  [UnlockArrangement.Arranged]: "手配済み",
  [UnlockArrangement.NotRequired]: "不要",
};

/**
 * 解錠の手配が未定（null）のときの表示ラベル（COND-027）。
 */
export const UNLOCK_ARRANGEMENT_UNDECIDED_LABEL = "未定";

/**
 * 団体向けの解錠の手配に関する案内文（COND-027 (6)）。
 *
 * 予約詳細や承認通知メールで、要手配・手配済みのときだけ団体へ表示・通知する。
 * 不要のときは何も案内しないため null とする。
 */
export const unlockArrangementGroupNotice: Record<UnlockArrangement, string | null> = {
  [UnlockArrangement.Required]:
    "当日施設が施錠されている可能性があります。事務局とメッセージで調整してください。",
  [UnlockArrangement.Arranged]: "解錠の手配が済んでいます。方法はメッセージを確認してください。",
  [UnlockArrangement.NotRequired]: null,
};

/**
 * フォーム等から届いた値を解錠の手配に解釈する（COND-027）。
 *
 * 知らない値や文字列でない値は null（未定）として返す。
 */
export const parseUnlockArrangement = (value: unknown): UnlockArrangement | null => {
  const values: readonly string[] = Object.values(UnlockArrangement);

  return typeof value === "string" && values.includes(value) ? (value as UnlockArrangement) : null;
};

/**
 * 承認・直接作成・承認済みの直接変更で、解錠の手配が選ばれているかを検証する（COND-027）。
 *
 * 解錠の手配は必須で既定値が無いため、未選択（null）の場合は InvalidInput エラーを返す。
 */
export const validateUnlockArrangement = (
  value: UnlockArrangement | null,
): Result<UnlockArrangement, ReservationError> => {
  if (value === null) {
    return err({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.UnlockArrangement,
      message: "解錠の手配が選択されていない。",
      userMessage: "解錠の手配を「要手配」「手配済み」「不要」から選んでください。",
    });
  }

  return ok(value);
};

/**
 * 変更すると、解錠の手配を選び直す項目（COND-027）。
 *
 * いまは再承認が要る項目（reapprovalRequiredFields）と同じだが、答えている問いが違うので表を分けてある。
 * あちらは「事務局に見せ直すか（仮予約に戻すか）」、こちらは「施錠される日時・場所が変わったので
 * 解錠の手配を判断し直すか」を問う。
 *
 * 使用人数・備考だけの変更では選び直さない。
 */
export const unlockArrangementReselectFields = {
  facilityId: true,
  startAt: true,
  endAt: true,
  headCount: false,
  note: false,
} as const satisfies Record<ReservationContentField, boolean>;

/**
 * 事務局による直接変更で、解錠の手配の選び直しが必要かどうかを判定する（COND-027 / UC-008）。
 *
 * 承認済みの予約で、施設または日時を 1 つでも変更したときだけ true となる。
 * 仮予約の変更や、承認済みで使用人数・備考のみを変更したときは false（選び直さない）。
 */
export const requiresUnlockArrangementReselection = (
  status: ReservationStatus,
  changed: ReadonlySet<ReservationContentField>,
): boolean => {
  if (status !== ReservationStatus.Approved) {
    return false;
  }

  return [...changed].some((field) => unlockArrangementReselectFields[field]);
};

/**
 * 団体の変更で、解錠の手配を未定（null）に戻すか（COND-027 / COND-005）。
 *
 * 施設・日時を変えて仮予約に戻ったとき（Reapproval）だけ戻す。施錠される日時・場所が変わり、
 * 事務局が承認し直すときに選び直すため。仮予約の編集（KeepProvisional）は未定のまま、
 * 承認済みのまま使用人数・備考だけを変えたとき（KeepApproved）は今の値を引き継ぐ。
 *
 * 真偽値の表にしているのは、変更の結果を増やしたときに「戻すか」を決めないと型エラーになるようにするため。
 */
const resetsUnlockArrangementOnGroupEdit = {
  [ReservationEditOutcome.KeepProvisional]: false,
  [ReservationEditOutcome.KeepApproved]: false,
  [ReservationEditOutcome.Reapproval]: true,
} as const satisfies Record<AppliedReservationEdit, boolean>;

/**
 * 団体の変更（UC-005 / UC-017）の後の、解錠の手配の値を決める（COND-027）。
 */
export const unlockArrangementAfterGroupEdit = (
  outcome: AppliedReservationEdit,
  current: UnlockArrangement | null,
): UnlockArrangement | null => (resetsUnlockArrangementOnGroupEdit[outcome] ? null : current);
