import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "./authz";
import { MembershipRole } from "./membership";

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
} as const;
export type ReservationAction = (typeof ReservationAction)[keyof typeof ReservationAction];

export const reservationPermissions: PermissionTable<MembershipRole, ReservationAction> = {
  [MembershipRole.Admin]: [ReservationAction.CreateProvisional],
  [MembershipRole.Member]: [ReservationAction.CreateProvisional],
};

export const ReservationErrorCode = {
  ReservationNotFound: "RESERVATION_NOT_FOUND",
  ReservationForbidden: "RESERVATION_FORBIDDEN",
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
  create(reservation: Reservation): ResultAsync<null, ReservationError>;
}
