import { and, asc, eq, gt } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { StaffPendingReservationsQuery } from "~/query/reservation/staff-pending-reservations";
import type { Database } from "../db";
import { hasOverlappingReservation } from "./reservation-overlap";

export const createStaffPendingReservationsQuery = (
  db: Database,
): StaffPendingReservationsQuery => ({
  /*
   * 件数を数えるために、表示する 5 件より多く読む。承認を待っている仮予約は
   * 多くても数十件なので、件数用の問い合わせを別に投げるより 1 回で読む方をとる。
   */
  findUpcomingProvisional: (now) =>
    ResultAsync.fromPromise(
      db
        .select({
          id: reservationTable.id,
          groupId: reservationTable.groupId,
          groupName: groupTable.name,
          facilityId: reservationTable.facilityId,
          facilityName: facilityTable.name,
          startAt: reservationTable.startAt,
          endAt: reservationTable.endAt,
          headCount: reservationTable.headCount,
          createdAt: reservationTable.createdAt,
          hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
          hasProvisionalOverlap: hasOverlappingReservation(db, ReservationStatus.Provisional),
        })
        .from(reservationTable)
        .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
        .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
        .where(
          and(
            eq(reservationTable.status, ReservationStatus.Provisional),
            gt(reservationTable.startAt, now),
          ),
        )
        .orderBy(asc(reservationTable.startAt), asc(reservationTable.id)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "承認待ちの仮予約の取得に失敗しました。",
        cause: error,
      }),
    ),
});
