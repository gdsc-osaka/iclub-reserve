import type { ResultAsync } from "neverthrow";

export const ReservationStatus = {
  Provisional: "provisional",
  Approved: "approved",
  Withdrawn: "withdrawn",
  Rejected: "rejected",
  Cancelled: "cancelled",
  CancelledByStaff: "cancelled_by_staff",
} as const;

export type ReservationStatus =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

export interface Reservation {
    id: string;
    Id: string;
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