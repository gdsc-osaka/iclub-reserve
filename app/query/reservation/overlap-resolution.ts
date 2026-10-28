import { and, eq, gte, lt } from "drizzle-orm";
import { err, ok, ResultAsync, safeTry } from "neverthrow";

import { facilityTable, groupTable, reservationTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import { ReservationStatus } from "~/domain/reservation";
import { toOverlapCluster } from "~/domain/reservation/overlap";
import type { Database } from "~/infra/db";
import { hasOverlappingReservation } from "~/infra/reservation/reservation-overlap";
import { addDays, startOfTokyoDay } from "~/lib/date";
import {
  reservationWithNamesColumns,
  type ReservationWithNames,
} from "../_shared/reservation-with-names";
import { ensureStaff } from "../_shared/staff";
import { QueryErrorCode, type QueryError } from "../error";

/** 重なりの解決のダイアログに並べる仮予約 1 件（COND-031） */
export interface OverlapResolutionCandidate extends ReservationWithNames {
  readonly id: string;
  readonly headCount: number;
  readonly note: string | null;
  /** 申請日時。まとまりの並びと「先着」に使う（INFO-001.requested_at） */
  readonly requestedAt: Date;
  /** 承認済みの予約と重なるか。重なるものは承認する予約に選べない（COND-001 / COND-031 (2)） */
  readonly hasApprovedOverlap: boolean;
}

export interface OverlapResolution {
  /** 開いた仮予約を含む重なりのまとまり。申請日時の古い順。開いた予約が仮予約でなければ空 */
  readonly candidates: readonly OverlapResolutionCandidate[];
}

export interface FindOverlapResolutionArgs {
  /** 事務局かどうか（COND-009）。全団体の予約の使用人数・備考を返すので、事務局だけが見られる */
  readonly isStaff: boolean;
  /** ダイアログを開いた仮予約の ID */
  readonly reservationId: string;
}

/**
 * 重なりの解決ダイアログに表示する仮予約のまとまりを取得する（COND-031 / ADR-012）。
 */
export const findOverlapResolution = (
  db: Database,
  args: FindOverlapResolutionArgs,
): ResultAsync<OverlapResolution, QueryError> =>
  safeTry(async function* () {
    yield* ensureStaff(
      args.isStaff,
      "事務局ではない人が、重なりの解決ダイアログの予約候補を取得しようとした。",
    );

    // 開いた予約の施設と開始日時を取得（無ければ NotFound）
    const targetRows = yield* ResultAsync.fromPromise(
      db
        .select({
          facilityId: reservationTable.facilityId,
          startAt: reservationTable.startAt,
        })
        .from(reservationTable)
        .where(eq(reservationTable.id, args.reservationId))
        .limit(1),
      wrapError(QueryErrorCode.DatabaseError, "予約の取得に失敗しました。"),
    );

    const target = targetRows.at(0);
    if (!target) {
      return err({
        code: QueryErrorCode.NotFound,
        message: `予約 ${args.reservationId} が見つかりませんでした。`,
      });
    }

    /*
     * 予約は日をまたがない（COND-021）ため、重なりをたどっても同じ日本時間の日の中で閉じる。
     * そのため、対象予約と同じ日の仮予約のみを読めばすべての重なりを漏れなく集められる。
     */
    const dayStart = startOfTokyoDay(target.startAt);
    const dayEnd = addDays(dayStart, 1);

    const rows = yield* ResultAsync.fromPromise(
      db
        .select({
          id: reservationTable.id,
          ...reservationWithNamesColumns,
          headCount: reservationTable.headCount,
          note: reservationTable.note,
          requestedAt: reservationTable.requestedAt,
          hasApprovedOverlap: hasOverlappingReservation(db, ReservationStatus.Approved),
        })
        .from(reservationTable)
        .innerJoin(groupTable, eq(reservationTable.groupId, groupTable.id))
        .innerJoin(facilityTable, eq(reservationTable.facilityId, facilityTable.id))
        .where(
          and(
            eq(reservationTable.facilityId, target.facilityId),
            eq(reservationTable.status, ReservationStatus.Provisional),
            gte(reservationTable.startAt, dayStart),
            lt(reservationTable.startAt, dayEnd),
          ),
        ),
      wrapError(QueryErrorCode.DatabaseError, "仮予約のまとまりの取得に失敗しました。"),
    );

    // 開いた予約を含むまとまりを返す。開いた予約が仮予約でなければ rows に含まれず空の配列になる
    const candidates = toOverlapCluster(args.reservationId, rows);

    return ok({ candidates });
  });
