import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";

import { facilityTable, groupTable, reservationTable, user } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationListFacility,
  ReservationListQuery,
  ReservationListRow,
  ReservationStatusCounts,
} from "~/query/reservation/reservation-list";
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
 * 終了した予約のステータス一覧。
 *
 * 取り消し・却下・キャンセル・事務局キャンセルの 4 状態を「終了」として束ねる（STATE-001）。
 */
const endedStatuses: readonly ReservationStatus[] = [
  ReservationStatus.Withdrawn,
  ReservationStatus.Rejected,
  ReservationStatus.Cancelled,
  ReservationStatus.CancelledByStaff,
];

/**
 * Cloudflare D1 (Drizzle) を使った ReservationListQuery の実装。
 *
 * 予約・施設・団体・作成者（ユーザー）を 1 回の問い合わせで結合する。
 * 件数分の往復が発生すると Cloudflare D1 では N+1 がそのままレイテンシに直結するため、
 * 一覧表示に必要なすべての列を JOIN で一度に取得する。
 */
export const createReservationListQuery = (db: Database): ReservationListQuery => ({
  findList: (args) => {
    // 絞り込み対象の団体が 0 件のときは、問い合わせずに空配列を返す（無駄な SQL 発行を防ぐ）
    if (args.groupIds !== null && args.groupIds.length === 0) {
      return okAsync([]);
    }

    const conditions: SQL[] = [];

    if (args.groupIds !== null) {
      conditions.push(inArray(reservationTable.groupId, [...args.groupIds]));
    }

    if (args.statuses.length > 0) {
      conditions.push(inArray(reservationTable.status, [...args.statuses]));
    }

    if (args.facilityId !== null) {
      conditions.push(eq(reservationTable.facilityId, args.facilityId));
    }

    if (args.from !== null) {
      conditions.push(gte(reservationTable.endAt, args.from));
    }

    if (args.to !== null) {
      conditions.push(lt(reservationTable.endAt, args.to));
    }

    const orderClauses =
      args.sort === "created_at_asc"
        ? [asc(reservationTable.createdAt), asc(reservationTable.id)]
        : args.sort === "start_at_desc"
          ? [desc(reservationTable.startAt), asc(reservationTable.id)]
          : [asc(reservationTable.startAt), asc(reservationTable.id)];

    let query = db
      .select({
        id: reservationTable.id,
        groupId: reservationTable.groupId,
        groupName: groupTable.name,
        facilityId: reservationTable.facilityId,
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderClauses);

    if (args.limit !== undefined) {
      query = query.limit(args.limit) as typeof query;
    }

    return ResultAsync.fromPromise(query, toDatabaseError("予約一覧の取得に失敗しました。")).map(
      (rows): readonly ReservationListRow[] => rows,
    );
  },

  countByStatus: (args) => {
    // 絞り込み対象の団体が 0 件のときは、問い合わせずにすべて 0 件で返す
    if (args.groupIds !== null && args.groupIds.length === 0) {
      return okAsync({ all: 0, provisional: 0, approved: 0, ended: 0 });
    }

    const conditions: SQL[] = [];

    if (args.groupIds !== null) {
      conditions.push(inArray(reservationTable.groupId, [...args.groupIds]));
    }

    if (args.facilityId !== null) {
      conditions.push(eq(reservationTable.facilityId, args.facilityId));
    }

    if (args.from !== null) {
      conditions.push(gte(reservationTable.endAt, args.from));
    }

    if (args.to !== null) {
      conditions.push(lt(reservationTable.endAt, args.to));
    }

    /*
     * D1 との往復を 1 回にまとめるため、COUNT と SUM(CASE WHEN ...) で 1 クエリに集約する。
     * SQLite ではマッチする行が 0 件のとき SUM が null を返すため、COALESCE で 0 に落とす。
     */
    const query = db
      .select({
        allCount: sql<number>`count(*)`,
        provisionalCount: sql<number>`coalesce(sum(case when ${reservationTable.status} = ${ReservationStatus.Provisional} then 1 else 0 end), 0)`,
        approvedCount: sql<number>`coalesce(sum(case when ${reservationTable.status} = ${ReservationStatus.Approved} then 1 else 0 end), 0)`,
        endedCount: sql<number>`coalesce(sum(case when ${reservationTable.status} in (${sql.join(
          endedStatuses.map((s) => sql`${s}`),
          sql`, `,
        )}) then 1 else 0 end), 0)`,
      })
      .from(reservationTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return ResultAsync.fromPromise(query, toDatabaseError("予約件数の集計に失敗しました。")).map(
      (rows): ReservationStatusCounts => {
        const head = rows.at(0);
        if (head === undefined) {
          return { all: 0, provisional: 0, approved: 0, ended: 0 };
        }

        return {
          all: Number(head.allCount),
          provisional: Number(head.provisionalCount),
          approved: Number(head.approvedCount),
          ended: Number(head.endedCount),
        };
      },
    );
  },

  findFacilities: () =>
    ResultAsync.fromPromise(
      db
        .select({
          id: facilityTable.id,
          name: facilityTable.name,
        })
        .from(facilityTable)
        .where(eq(facilityTable.isActive, true))
        .orderBy(asc(facilityTable.name), asc(facilityTable.id)),
      toDatabaseError("施設・設備一覧の取得に失敗しました。"),
    ).map((rows): readonly ReservationListFacility[] =>
      rows.map((row) => ({ id: row.id, name: row.name })),
    ),
});
