import { env } from "cloudflare:workers";
import { data } from "react-router";

import { ReservationErrorCode } from "~/domain/reservation";
import { createDb } from "~/infra/db";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import {
  getReservationUseCase,
  type GetReservationArgs,
  type GetReservationDeps,
} from "~/usecases/reservation/get-reservation";

import type { Route } from "./+types/route";

export async function loader({ params }: Route.LoaderArgs) {
  const reservationId = params.reservationId;

  const db = createDb(env.DB);
  const Deps: GetReservationDeps = {
    reservationRepository: createReservationRepository(db),
  };
  const Args: GetReservationArgs = {
    reservationId: reservationId,
  };
  const reservationResult = await getReservationUseCase(Deps, Args);
  if (reservationResult.isErr()) {
    const error = reservationResult.error;

    if (error.code === ReservationErrorCode.ReservationNotFound) {
      throw data({ message: "Reservation Not Found." }, { status: 404 });
    }
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return reservationResult.value;
}

export default function Reservation({ loaderData: reservation }: Route.ComponentProps) {
  return <div>{JSON.stringify(reservation)}</div>;
}
