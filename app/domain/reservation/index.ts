import type { ResultAsync } from "neverthrow";

import type { PermissionTable } from "../authz";
import type { MailDraft } from "../mail/mail-outbox";
import { MembershipRole } from "../membership";

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
 * 役割の表では表せない。判定は transition.ts の canTransition の `isStaff` で行う。
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

export const ReservationErrorCode = {
  ReservationNotFound: "RESERVATION_NOT_FOUND",
  ReservationForbidden: "RESERVATION_FORBIDDEN",
  /** 申請できない利用時間（刻み・利用可能時間・日またぎ・過去日時） */
  ReservationInvalidPeriod: "RESERVATION_INVALID_PERIOD",
  /** 利用時間以外の入力が不正（使用人数・備考） */
  ReservationInvalidInput: "RESERVATION_INVALID_INPUT",
  /** 不正なステータス遷移（許可されていない状態からの操作） */
  ReservationInvalidTransition: "RESERVATION_INVALID_TRANSITION",
  /**
   * 同一施設・同一時間帯に承認済みの予約がある（COND-001）、
   * または同じ予約に対する別の操作が先に反映された
   */
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

/** 重複の確認（COND-001）に渡す時間帯。 */
export interface ReservationOverlapArgs {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** 予約ステータスを条件付きで更新するときの引数 */
export interface ApplyStatusTransitionArgs {
  readonly id: string;
  /**
   * 操作前の予約ステータス（読んだときの状態）。
   *
   * DB がこの状態のままでなければ 1 件も更新しない。同じ予約を 2 人が同時に
   * 操作したとき、あとから届いた方が相手の結果を上書きしてしまうのを防ぐ。
   */
  readonly expectedStatus: ReservationStatus;
  /** 更新後の予約ステータス */
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly updatedAt: Date;
  /**
   * 承認（approve）のときだけ true。
   *
   * 同一施設・同一時間帯に承認済みの予約が無いこと（COND-001）を、
   * ステータスの更新と同じ 1 文の中で確かめる。
   */
  readonly requireNoApprovedOverlap: boolean;
}

/** 予約作成の結果。予約の INSERT は条件付きではないので applied は持たない */
export interface CreateReservationOutcome {
  /** この操作で outbox に積んだメールの ID。Queues への投入に使う */
  readonly enqueuedMailIds: readonly string[];
}

/** 条件付き更新の結果。更新できなかった (競合した) ときは ID の配列は空になる（ADR-002 決定 2.1） */
export interface ApplyStatusTransitionOutcome {
  readonly applied: boolean;
  /** この操作で outbox に積んだメールの ID。Queues への投入に使う */
  readonly enqueuedMailIds: readonly string[];
}

export interface ReservationRepository {
  findById(id: string): ResultAsync<Reservation, ReservationError>;
  create(
    reservation: Reservation,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateReservationOutcome, ReservationError>;
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
   * 予約のステータス・理由・更新日時を条件付きで更新し、通知メールがあれば同じトランザクション（db.batch）で outbox に積む。
   *
   * @param args ステータス更新の条件と値
   * @param mails 同時に outbox に積むメール（承認時の通知など）。不可分に書く手段として同じメソッドで受け取る。
   * @returns 更新結果と積まれたメール ID の配列。条件に合わず 0 件だったら applied: false（競合）。
   */
  applyStatusTransition(
    args: ApplyStatusTransitionArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<ApplyStatusTransitionOutcome, ReservationError>;
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
