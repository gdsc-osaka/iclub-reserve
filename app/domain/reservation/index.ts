import { err, ok, type Result, type ResultAsync } from "neverthrow";
/*
 * ドメインから `~/lib` を参照しているのはここだけ。
 * `app/lib/date.ts` は何も import しない純粋な日付計算なので、
 * 参照しても外側（DB・画面・通信）への依存は増えない。
 * 日本時間での判定を自前で書き直すと、同じ計算が 2 か所に散らばる。
 */
import type { PermissionTable } from "../authz";
import { canPerform, MembershipRole, type Membership } from "../membership";
import { validateTransitionReason } from "./validation";

export const ReservationStatus = {
  Provisional: "provisional",
  Approved: "approved",
  Withdrawn: "withdrawn",
  Rejected: "rejected",
  Cancelled: "cancelled",
  CancelledByStaff: "cancelled_by_staff",
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export interface Reservation {
  id: string;
  facilityId: string;
  groupId: string;
  startAt: Date;
  endAt: Date;
  headCount: number;
  note: string | null;
  status: ReservationStatus;
  statusReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ReservationAction = {
  CreateProvisional: "create_provisional",
  Withdraw: "withdraw",
  Cancel: "cancel",
} as const;
export type ReservationAction = (typeof ReservationAction)[keyof typeof ReservationAction];

/**
 * 団体の中での役割ごとに許可する操作。
 *
 * 承認・却下・事務局キャンセルはここに無い。事務局の権限は団体での役割とは
 * 別の軸にあり（COND-009）、団体に所属していない事務局の人にも成り立つため、
 * 役割の表では表せない。判定は {@link canTransition} の `isStaff` で行う。
 */
export const reservationPermissions: PermissionTable<MembershipRole, ReservationAction> = {
  [MembershipRole.Admin]: [
    ReservationAction.CreateProvisional,
    ReservationAction.Withdraw,
    ReservationAction.Cancel,
  ],
  [MembershipRole.Member]: [
    ReservationAction.CreateProvisional,
    ReservationAction.Withdraw,
    ReservationAction.Cancel,
  ],
};

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
 * 操作種別に対応する遷移先の予約ステータス。
 */
export const transitionTargetStatus: Record<ReservationTransition, ReservationStatus> = {
  [ReservationTransition.Withdraw]: ReservationStatus.Withdrawn,
  [ReservationTransition.Cancel]: ReservationStatus.Cancelled,
  [ReservationTransition.Approve]: ReservationStatus.Approved,
  [ReservationTransition.Reject]: ReservationStatus.Rejected,
  [ReservationTransition.StaffCancel]: ReservationStatus.CancelledByStaff,
};

export const ReservationErrorCode = {
  ReservationNotFound: "RESERVATION_NOT_FOUND",
  ReservationForbidden: "RESERVATION_FORBIDDEN",
  /** 申請できない利用時間（刻み・利用可能時間・日またぎ・過去日時） */
  ReservationInvalidPeriod: "RESERVATION_INVALID_PERIOD",
  /** 利用時間以外の入力が不正（使用人数・備考） */
  ReservationInvalidInput: "RESERVATION_INVALID_INPUT",
  /** 不正なステータス遷移（許可されていない状態からの操作） */
  ReservationInvalidTransition: "RESERVATION_INVALID_TRANSITION",
  /** 同一施設・同一時間帯に承認済みの予約がある（COND-001） */
  ReservationConflict: "RESERVATION_CONFLICT",
  /** 申請元に選んだ団体が有効でない（COND-006） */
  ReservationGroupNotEligible: "RESERVATION_GROUP_NOT_ELIGIBLE",
  /** 申請先に選んだ施設・設備が見つからない、または無効になっている */
  ReservationFacilityNotAvailable: "RESERVATION_FACILITY_NOT_AVAILABLE",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type ReservationErrorCode = (typeof ReservationErrorCode)[keyof typeof ReservationErrorCode];

export interface ReservationError {
  readonly code: ReservationErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

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

/** 重複の確認（COND-001）に渡す時間帯。 */
export interface ReservationOverlapArgs {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** 予約ステータスの更新引数 */
export interface UpdateReservationStatusArgs {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly updatedAt: Date;
}

export interface ReservationRepository {
  findById(id: string): ResultAsync<Reservation, ReservationError>;
  create(reservation: Reservation): ResultAsync<null, ReservationError>;
  /**
   * 同一施設・同一時間帯に**承認済み**の予約があるかを調べる（COND-001）。
   *
   * 仮予約は数えない。重複を禁じているのは承認済みの予約に対してだけで、
   * 仮予約どうしは重なってよい（事務局がどちらを承認するかを選ぶ）。
   *
   * 時間帯が重なるかどうかは「開始 < 相手の終わり」かつ「終わり > 相手の開始」で見る。
   * 終了時刻は予約に含まれないので、10:00 に終わる予約と 10:00 に始まる予約は重ならない。
   */
  existsApprovedOverlap(args: ReservationOverlapArgs): ResultAsync<boolean, ReservationError>;
  /**
   * 予約のステータスと更新日時、およびステータス理由を更新する。
   */
  updateStatus(args: UpdateReservationStatusArgs): ResultAsync<null, ReservationError>;
}

/**
 * 予約時間の刻み（分）。開始・終了ともこの倍数にそろえる。
 *
 * 空き状況カレンダー（SCR-001）の枠は 1 時間単位だが、申請はここまで細かく選べる。
 * 1 時間単位に合わせてしまうと「10:30 から 1 時間だけ使いたい」が表せず、
 * 実際には空いている 30 分を誰も使えないまま押さえることになる。
 *
 * INFO-002（施設/設備）に刻みの属性が無いので、全施設で同じ値にしている。
 * 施設ごとに変えたくなったら、まず情報モデルに属性を足すこと。
 */
export const RESERVATION_STEP_MINUTES = 30;

/** 予約の利用時間。開始時刻を含み、終了時刻は含まない。 */
export interface ReservationPeriod {
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * 使用人数の下限（INFO-001: 使用人数は必須）。
 *
 * 上限は決めていない。INFO-002（施設/設備）に定員の属性が無いので、
 * 上限を書くとすれば情報モデルに無い数字を画面の中だけで決めることになる。
 */
export const RESERVATION_MIN_HEAD_COUNT = 1;

/**
 * 備考の最大文字数。
 *
 * INFO-001 に長さの定めは無いが、入力欄に上限が無いと、
 * 事務局が予約一覧で内容を見比べられない量を貼り付けられてしまう。
 */
export const RESERVATION_NOTE_MAX_LENGTH = 500;

/** 利用時間のほかに、申請の中身として確かめること。 */
export interface ReservationDetail {
  readonly headCount: number;
  readonly note: string | null;
}

/** これから作ろうとしている予約の中身。 */
export type ReservationDraft = ReservationPeriod & ReservationDetail;

/**
 * 空き状況カレンダー（SCR-001）に描くステータス。
 *
 * 終了した予約（取り消し済み・却下済み・キャンセル済み・事務局キャンセル済み）は描かない。
 * これらを描くと、実際には空いている時間帯が埋まっているように見えてしまい、
 * 「空き状況を確認する」（UC-001）という画面の目的が果たせなくなるため。
 *
 * COND-008 が「ステータスを問わず表示する」と定めているのは
 * **どこまでの項目を開示するか**の話であり、どの予約を描くかの話ではない。
 * 終了した予約は予約一覧（SCR-003）と予約詳細（SCR-005）で確認できる。
 */
export const calendarVisibleStatuses = [
  ReservationStatus.Provisional,
  ReservationStatus.Approved,
] as const;
