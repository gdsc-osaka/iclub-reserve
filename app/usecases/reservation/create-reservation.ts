import { createId } from "@paralleldrive/cuid2";
import { errAsync, type ResultAsync } from "neverthrow";
import { canPerform, type MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  type Reservation,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";

export interface CreateProvisionalReservationDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface CreateProvisionalReservationArgs {
  readonly actorUserId: string;
  readonly reservation: {
    facilityId: string;
    groupId: string;
    startAt: Date;
    endAt: Date;
    headCount: number;
    note: string | null;
  };
}

export interface CreateProvisionalReservationReturns {
  reservationId: string;
}

export const createProvisionalReservationUseCase = (
  deps: CreateProvisionalReservationDeps,
  args: CreateProvisionalReservationArgs,
): ResultAsync<CreateProvisionalReservationReturns, ReservationError> => {
  const id = createId();
  const now = new Date();
  const reservation: Reservation = {
    ...args.reservation,
    id,
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: args.actorUserId,
    createdAt: now,
    updatedAt: now,
  };

  return deps.membershipRepository
    .findByGroupAndUser(args.reservation.groupId, args.actorUserId)
    .andThen((membership) =>
      canPerform(reservationPermissions, membership, ReservationAction.CreateProvisional)
        ? deps.reservationRepository.create(reservation)
        : errAsync({
            code: ReservationErrorCode.ReservationForbidden,
            message: "予約を作成する権限がありません。",
          } satisfies ReservationError),
    )
    .map(() => ({ reservationId: id }));
};
