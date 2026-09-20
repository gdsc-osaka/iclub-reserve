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
 * その操作を実行できる、操作前の予約ステータス（STATE-001）。
 *
 * 仮予約からは取り消し・承認・却下へ、承認済みからはキャンセル（団体・事務局）へ進む。
 * 終了した状態（取り消し済み・却下済み・キャンセル済み）からは動かせない。
 *
 * {@link canTransition} の判定と、DB を更新するときの条件（「読んだときの状態から
 * 変わっていないこと」）で同じ表を使う。2 か所に書くと、片方だけ直したときに
 * 「画面では弾かれるのに DB では通る」食い違いが生まれる。
 */
export const transitionSourceStatus: Record<ReservationTransition, ReservationStatus> = {
  [ReservationTransition.Withdraw]: ReservationStatus.Provisional,
  [ReservationTransition.Cancel]: ReservationStatus.Approved,
  [ReservationTransition.Approve]: ReservationStatus.Provisional,
  [ReservationTransition.Reject]: ReservationStatus.Provisional,
  [ReservationTransition.StaffCancel]: ReservationStatus.Approved,
};

/**
 * その操作を誰に許すか（COND-009）。
 *
 * 団体の操作は権限表（{@link reservationPermissions}）の操作名を、
 * 事務局だけの操作は "staff" を持つ。事務局の権限は団体での役割とは別の軸にあり、
 * 団体に所属していない事務局の人にも成り立つため、役割の表では表せない。
 *
 * この表は 2 か所から読む。{@link canTransition} の権限判定と、画面（ルート）が
 * 受け付ける操作の絞り込み（{@link isStaffTransition}）である。どちらかが
 * 操作の一覧を自前で書き写すと、操作を増やしたときに片方だけ直して食い違う。
 */
export const transitionAuthority = {
  [ReservationTransition.Withdraw]: ReservationAction.Withdraw,
  [ReservationTransition.Cancel]: ReservationAction.Cancel,
  [ReservationTransition.Approve]: "staff",
  [ReservationTransition.Reject]: "staff",
  [ReservationTransition.StaffCancel]: "staff",
} as const satisfies Record<ReservationTransition, ReservationAction | "staff">;

/**
 * 事務局だけが実行できる操作かどうか（COND-009）。
 *
 * 事務局の画面（/staff/reservations）と団体の画面（/reservations）で、
 * 受け付ける操作を分けるために使う。
 */
export const isStaffTransition = (transition: ReservationTransition): boolean =>
  transitionAuthority[transition] === "staff";

/**
 * フォームから届いた値を操作として読み取る。知らない値は null。
 *
 * 画面から送られてくる値は文字列でしかないので、ドメインの言葉に直す入口をここに置く。
 * ルート側で「この 2 つのどちらか」と書き並べると、操作が増えるたびに
 * ルートの方も直すことになり、直し忘れるとその操作だけ動かない。
 */
export const parseReservationTransition = (value: unknown): ReservationTransition | null => {
  const transitions: readonly string[] = Object.values(ReservationTransition);

  return typeof value === "string" && transitions.includes(value)
    ? (value as ReservationTransition)
    : null;
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
 * 今の状態では操作できないことを伝える文言。
 *
 * 「この操作はできません」だけでは、利用者は自分の画面が古いのか
 * そもそも許されない操作なのか分からない。今どの状態なのかを添える。
 */
const statusMismatchMessage = (current: ReservationStatus): string => {
  switch (current) {
    case ReservationStatus.Provisional:
      return "仮予約に対してはこの操作を実行できません。";
    case ReservationStatus.Approved:
      return "承認済みの予約に対してはこの操作を実行できません。";
    default:
      return "終了した予約に対してはこの操作を実行できません。";
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
  /*
   * 1. 操作権限の確認（COND-009）
   *
   * 「どの操作を誰に許すか」は transitionAuthority が持つ。ここで操作ごとに
   * 分岐を書き並べないのは、操作が増えたときに表とこの判定がずれないようにするため。
   */
  const authority = transitionAuthority[transition];

  if (authority === "staff") {
    if (!actor.isStaff) {
      return err({
        code: ReservationErrorCode.ReservationForbidden,
        message: "この操作は事務局スタッフのみ実行できます。",
      });
    }
    /*
     * 団体側の操作は、役割ごとの権限表（reservationPermissions）で判定する。
     * ここで `membership !== null` を自前で書かないのは、書き忘れを防ぐため
     * （app/domain/membership の canPerform を参照）。
     */
  } else if (!canPerform(reservationPermissions, actor.membership, authority)) {
    return err({
      code: ReservationErrorCode.ReservationForbidden,
      message: "所属している団体の予約のみ操作できます。",
    });
  }

  // 2. 現在のステータスからの遷移可否（STATE-001）
  if (reservation.status !== transitionSourceStatus[transition]) {
    return err({
      code: ReservationErrorCode.ReservationInvalidTransition,
      message: statusMismatchMessage(reservation.status),
    });
  }

  // 3. 理由の入力検証（理由が引数として与えられている場合のみ検証）
  if (reason !== undefined) {
    return validateTransitionReason(transition, reason).map(() => undefined);
  }

  return ok(undefined);
};
