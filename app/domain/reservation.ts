import type { ResultAsync } from "neverthrow";

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

export const ReservationErrorCode = {
  ReservationNotFound: "RESERVATION_NOT_FOUND",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type ReservationErrorCode = (typeof ReservationErrorCode)[keyof typeof ReservationErrorCode];

export interface ReservationError {
  readonly code: ReservationErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ReservationRepository {
  findById(id: string): ResultAsync<Reservation, ReservationError>;
}

/**
 * まだ結果が確定していない予約のステータス。
 *
 * 「これから使う予定」と「終わった記録」を分ける唯一の定義元。
 * ここに挙がっていないステータス (取り消し・却下・キャンセル) は、
 * 日時が未来であっても施設を押さえていないので、予定ではなく記録として扱う。
 */
export const ACTIVE_RESERVATION_STATUSES = [
  ReservationStatus.Provisional,
  ReservationStatus.Approved,
] as const satisfies readonly ReservationStatus[];

/** 予約がまだ生きている (施設を押さえている) ステータスかどうかを判定する。 */
export const isActiveReservationStatus = (status: ReservationStatus): boolean =>
  (ACTIVE_RESERVATION_STATUSES as readonly ReservationStatus[]).includes(status);
