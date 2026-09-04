import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";

import type { Reservation, ReservationError, ReservationRepository } from "~/domain/reservation";
import { ReservationErrorCode } from "~/domain/reservation";

export interface GetReservationDeps {
  readonly reservationRepository: ReservationRepository;
}

export interface GetReservationArgs {
  readonly reservationId: string;
}

export const getReservationUseCase = (
  deps: GetReservationDeps,
  args: GetReservationArgs,
): ResultAsync<Reservation, ReservationError> => {
  const id = args.reservationId.trim();

  if (id === "") {
    return errAsync({
      code: ReservationErrorCode.ReservationNotFound,
      message: "予約 ID が指定されていません。",
    });
  }

  return deps.reservationRepository.findById(id);
};