import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { facilityTable, groupTable, reservationTable, user } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationDetailQuery,
  ReservationDetailRow,
} from "~/query/reservation/reservation-detail";
import type { Database } from "../db";
import { hasOverlappingReservation } from "./reservation-overlap";

/** DB アクセスの失敗を Query のエラーに変える */
const toDatabaseError =
  (message: string) =>
  (error: unknown): QueryError => ({
    code: QueryErrorCode.DatabaseError,
    message,
    cause: error,
  });

/**
 * Cloudflare D1 (Drizzle) を使った ReservationDetailQuery の実装。
 *
 * 予約・施設・団体・作成者（ユーザー）を 1 回の問い合わせで結合する。
 * 件数分の往復が発生すると Cloudflare D1 では N+1 がそのままレイテンシに直結するため、
 * 詳細表示に必要なすべての列を JOIN で一度に取得する。
 */
export const createReservationDetailQuery = (db: Database): ReservationDetailQuery => ({
  findByReservationId: (reservationId: string) => {
    const query = db
      .select({
        id: reservationTable.id,
        groupId: reservationTable.groupId,
        groupName: groupTable.name,
        facilityName: facilityTable.name,
        startAt: reservationTable.startAt,
        endAt: reservationTable.endAt,
        status: reservationTable.status,
        statusReason: reservationTable.statusReason,
        headCount: reservationTable.headCount,
        note: reservationTable.note,
        createdByName: user.name,
        createdAt: reservationTable.createdAt,
        hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
        hasProvisionalOverlap: hasOverlappingReservation(db, ReservationStatus.Provisional),
      })
      .from(reservationTable)
      .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
      .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
      // 作成者が未設定または削除済みでも予約行自体が落ちないよう leftJoin にする
      .leftJoin(user, eq(reservationTable.createdBy, user.id))
      .where(eq(reservationTable.id, reservationId))
      .limit(1);

    return ResultAsync.fromPromise(query, toDatabaseError("予約詳細の取得に失敗しました。")).map(
      (rows): ReservationDetailRow | null => rows.at(0) ?? null,
    );
  },
});
