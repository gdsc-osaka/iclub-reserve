import { err, ok, ResultAsync } from "neverthrow";
import { ReservationErrorCode, type Reservation, type ReservationError, type ReservationRepository } from "~/domain/reservation";
import type { Database } from "../db";
import {eq} from "drizzle-orm";
import { ReservationTable} from "~/db/schema";

export const createReservationRepository = (db: Database):  ReservationRepository => {
    const findById = (id: string): ResultAsync<Reservation, ReservationError> => {
        return ResultAsync.fromPromise(
            db.select().from(ReservationTable).where(eq(ReservationTable.id, id)).limit(1),
            (error): ReservationError => ({
                code: ReservationErrorCode.DatabaseError,
                message: "Failed to query the database",
                cause: error
            })
        ).andThen((rows) => {
            const row = rows.at(0);

            if (row === undefined) {
                return err({
                    code: ReservationErrorCode.ReservationNotFound,
                    message: "Reservation not Found"
                });
            }

            return ok(row);
        })
    };

    return {findById};
};