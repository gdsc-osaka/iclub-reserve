import { asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { reservationMessageTable, user } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { QueryErrorCode } from "~/query/error";
import type {
  ReservationMessageListQuery,
  ReservationMessageRow,
} from "~/query/reservation/reservation-message-list";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った ReservationMessageListQuery の実装。
 *
 * reservation_message と user を結合して 1 回の問い合わせで取得する。
 * 送信日時（sent_at）昇順、同じ時刻なら ID（id）昇順で並べる。
 */
export const createReservationMessageListQuery = (db: Database): ReservationMessageListQuery => ({
  listByReservationId: (reservationId: string) => {
    const query = db
      .select({
        id: reservationMessageTable.id,
        senderId: reservationMessageTable.senderId,
        senderName: user.name,
        sentAsStaff: reservationMessageTable.sentAsStaff,
        body: reservationMessageTable.body,
        sentAt: reservationMessageTable.sentAt,
      })
      .from(reservationMessageTable)
      .innerJoin(user, eq(reservationMessageTable.senderId, user.id))
      .where(eq(reservationMessageTable.reservationId, reservationId))
      .orderBy(asc(reservationMessageTable.sentAt), asc(reservationMessageTable.id));

    return ResultAsync.fromPromise(
      query,
      wrapError(QueryErrorCode.DatabaseError, "予約メッセージ一覧の取得に失敗しました。"),
    ).map((rows): readonly ReservationMessageRow[] => rows);
  },
});
