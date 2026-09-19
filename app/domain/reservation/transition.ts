import { err, ok, type Result } from "neverthrow";

import { canPerform, type Membership } from "../membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  type Reservation,
  type ReservationError,
} from ".";

/*
 * 予約の状態変更（STATE-001）をまとめたファイル。
 *
 * 「誰が実行できるか」「今の状態から動かせるか」「理由が要るか」は
 * 1 つの操作を許すかどうかを決める 3 つの条件で、別々の場所に置くと
 * 片方だけ直して食い違う。判定は canTransition に集めてある。
 *
 * 申請の中身が成り立つかの検証（validation.ts）とは分けている。
 * あちらは所属も現在の状態も見ない、フォームの値だけで完結する検証。
 *
 * このファイルは index.ts を参照するが、index.ts はこのファイルを参照しない。
 * 逆向きの参照を足すと循環 import になり、どちらかのトップレベルの定数が
 * 未初期化のまま読まれて落ちる。
 */

/**
 * 予約の状態変更操作（STATE-001）。
 *
 * - withdraw: 団体メンバーによる仮予約の取り消し（provisional → withdrawn）
 * - cancel: 団体メンバーによる承認済み予約のキャンセル（approved → cancelled）
 * - approve: 事務局による仮予約の承認（provisional → approved）
 * - reject: 事務局による仮予約の却下（provisional → rejected）
 * - staffCancel: 事務局による承認済み予約のキャンセル（approved → cancelled_by_staff）
 */
export const ReservationTransition = {
  Withdraw: "withdraw",
  Cancel: "cancel",
  Approve: "approve",
  Reject: "reject",
  StaffCancel: "staffCancel",
} as const;
export type ReservationTransition =
  (typeof ReservationTransition)[keyof typeof ReservationTransition];

/**
 * 操作種別に対応する遷移先の予約ステータス。
 */
export const transitionTargetStatus: Record<ReservationTransition, ReservationStatus> = {
  [ReservationTransition.Withdraw]: ReservationStatus.Withdrawn,
  [ReservationTransition.Cancel]: ReservationStatus.Cancelled,
  [ReservationTransition.Approve]: ReservationStatus.Approved,
  [ReservationTransition.Reject]: ReservationStatus.Rejected,
  [ReservationTransition.StaffCancel]: ReservationStatus.CancelledByStaff,
};

/**
 * 状態変更操作の実行者。
 *
 * 団体の中での権限（取り消し・キャンセル）と、事務局の権限（承認・却下・事務局キャンセル）は
 * 別の軸にある（COND-009）。そのため所属と事務局フラグの両方を持ち、
 * 団体側の判定は必ず権限表（{@link reservationPermissions}）を通す。
 */
export interface ReservationActor {
  /** 事務局スタッフかどうか（COND-009: 事務局は全団体の予約を操作可能） */
  readonly isStaff: boolean;
  /**
   * その予約が属する団体での所属。所属していない場合は null。
   *
   * null を渡せば必ず不許可になる（Membership の `canPerform`）ので、
   * 「所属を確かめ忘れたまま操作できてしまう」ことが起きない。
   */
  readonly membership: Membership | null;
}

/**
 * 操作理由の妥当性を検証する（COND-002）。
 *
 * 事務局による却下（reject）およびキャンセル（staffCancel）は理由入力が必須（空文字・空白のみも拒否）。
 * 団体による取り消し（withdraw）およびキャンセル（cancel）は任意。
 * 承認（approve）は理由不要（null を返す）。
 */
export const validateTransitionReason = (
  transition: ReservationTransition,
  reason?: string | null,
): Result<string | null, ReservationError> => {
  const trimmed = reason?.trim() ?? "";

  switch (transition) {
    case ReservationTransition.Reject:
      if (trimmed === "") {
        return err({
          code: ReservationErrorCode.ReservationInvalidInput,
          message: "却下理由を入力してください。",
        });
      }
      return ok(trimmed);

    case ReservationTransition.StaffCancel:
      if (trimmed === "") {
        return err({
          code: ReservationErrorCode.ReservationInvalidInput,
          message: "キャンセル理由を入力してください。",
        });
      }
      return ok(trimmed);

    case ReservationTransition.Withdraw:
    case ReservationTransition.Cancel:
      return ok(trimmed !== "" ? trimmed : null);

    case ReservationTransition.Approve:
      return ok(null);
  }
};

/**
 * 予約に対する状態変更操作が可能かを判定する純粋関数（STATE-001 / COND-002 / COND-009）。
 *
 * 画面でのボタン表示可否判定にも使えるよう、reason が渡された場合のみ COND-002（理由の検証）も行う。
 *
 * @param reservation 現在の予約情報（status を参照）
 * @param transition 実行したい操作
 * @param actor 操作者（事務局かどうかと、その予約の団体での所属）
 * @param reason 操作理由（省略時はステータス遷移と権限のみを検証）
 */
export const canTransition = (
  reservation: Pick<Reservation, "status">,
  transition: ReservationTransition,
  actor: ReservationActor,
  reason?: string | null,
): Result<void, ReservationError> => {
  // 1. 操作権限の確認
  switch (transition) {
    /*
     * 団体側の操作は、役割ごとの権限表（reservationPermissions）で判定する。
     * ここで `membership !== null` を自前で書かないのは、書き忘れを防ぐため
     * （app/domain/membership の canPerform を参照）。
     */
    case ReservationTransition.Withdraw:
      if (!canPerform(reservationPermissions, actor.membership, ReservationAction.Withdraw)) {
        return err({
          code: ReservationErrorCode.ReservationForbidden,
          message: "所属している団体の予約のみ操作できます。",
        });
      }
      break;

    case ReservationTransition.Cancel:
      if (!canPerform(reservationPermissions, actor.membership, ReservationAction.Cancel)) {
        return err({
          code: ReservationErrorCode.ReservationForbidden,
          message: "所属している団体の予約のみ操作できます。",
        });
      }
      break;

    case ReservationTransition.Approve:
    case ReservationTransition.Reject:
    case ReservationTransition.StaffCancel:
      if (!actor.isStaff) {
        return err({
          code: ReservationErrorCode.ReservationForbidden,
          message: "この操作は事務局スタッフのみ実行できます。",
        });
      }
      break;
  }

  // 2. 現在のステータスからの遷移可否（STATE-001）
  switch (transition) {
    case ReservationTransition.Withdraw:
    case ReservationTransition.Approve:
    case ReservationTransition.Reject:
      if (reservation.status !== ReservationStatus.Provisional) {
        return err({
          code: ReservationErrorCode.ReservationInvalidTransition,
          message:
            reservation.status === ReservationStatus.Approved
              ? "承認済みの予約に対してはこの操作を実行できません。"
              : "終了した予約に対してはこの操作を実行できません。",
        });
      }
      break;

    case ReservationTransition.Cancel:
    case ReservationTransition.StaffCancel:
      if (reservation.status !== ReservationStatus.Approved) {
        return err({
          code: ReservationErrorCode.ReservationInvalidTransition,
          message:
            reservation.status === ReservationStatus.Provisional
              ? "仮予約に対してはこの操作を実行できません。"
              : "終了した予約に対してはこの操作を実行できません。",
        });
      }
      break;
  }

  // 3. 理由の入力検証（理由が引数として与えられている場合のみ検証）
  if (reason !== undefined) {
    return validateTransitionReason(transition, reason).map(() => undefined);
  }

  return ok(undefined);
};
