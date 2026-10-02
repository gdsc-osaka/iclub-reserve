import { and, eq, exists, gt, lt, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { reservationTable } from "~/db/schema";
import type { ReservationStatus } from "~/domain/reservation";
import type { Database } from "../db";

/** 重なりを探すとき、同じ予約テーブルをもう一度読むための別名 */
const overlapping = alias(reservationTable, "overlapping");

/**
 * その予約と時間帯が重なる、指定したステータスの予約があるかを調べる SQL 式（exists）を組み立てる。
 *
 * 重なりの判定は 2 種類ある。
 * - 承認済みとの重なり: 承認できない（COND-001）
 * - 他の仮予約との重なり: 承認は止めないが、申請が競合していることを知らせる
 * 終了時刻はその予約に含まれないので、10:00 に終わる予約と 10:00 に始まる予約は重ならない。
 *
 * 外側（一覧や詳細に出る行）は reservationTable、内側（重なりを探す側）は overlapping と、
 * 同じ表を 2 つの名前で参照する。列はどちらも Drizzle の定義から辿るので、
 * 列名を変えたときは SQL ではなく型エラーとして分かる。
 */
export const hasOverlappingReservation = (db: Database, status: ReservationStatus) =>
  exists(
    db
      .select({ id: overlapping.id })
      .from(overlapping)
      .where(
        and(
          eq(overlapping.facilityId, reservationTable.facilityId),
          eq(overlapping.status, status),
          ne(overlapping.id, reservationTable.id),
          lt(overlapping.startAt, reservationTable.endAt),
          gt(overlapping.endAt, reservationTable.startAt),
        ),
      ),
    // SQLite の exists は 0 / 1 を返すので、画面へ渡す前に真偽値にそろえる
  ).mapWith(Boolean);
