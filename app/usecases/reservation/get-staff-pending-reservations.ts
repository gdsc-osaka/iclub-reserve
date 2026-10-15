import { errAsync, type ResultAsync } from "neverthrow";

import { STAFF_PENDING_RESERVATIONS_LIMIT, isShortNotice } from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  StaffPendingReservationItem,
  StaffPendingReservationsQuery,
} from "~/query/reservation/staff-pending-reservations";

export interface GetStaffPendingReservationsDeps {
  readonly staffPendingReservationsQuery: StaffPendingReservationsQuery;
}

export interface GetStaffPendingReservationsArgs {
  /** 事務局かどうか（COND-009）。承認待ちは全団体の予約なので、事務局だけが見られる */
  readonly isStaff: boolean;
  readonly now: Date;
}

export interface StaffPendingReservations {
  /** 開始日時の近い順に、最大 5 件 */
  readonly items: readonly StaffPendingReservationItem[];
  /** 開始日時が今より後の仮予約の総数 */
  readonly totalCount: number;
  /** うち利用日まで 7 日を切っている数（COND-028） */
  readonly shortNoticeCount: number;
}

/**
 * 事務局のダッシュボードの「承認待ちの予約」と、その件数を取得する（SCR-022 / UC-006）。
 */
export const getStaffPendingReservationsUseCase = (
  deps: GetStaffPendingReservationsDeps,
  args: GetStaffPendingReservationsArgs,
): ResultAsync<StaffPendingReservations, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではない人が、承認待ちの仮予約を取得しようとした。",
    });
  }

  return deps.staffPendingReservationsQuery.findUpcomingProvisional(args.now).map((rows) => ({
    items: rows.slice(0, STAFF_PENDING_RESERVATIONS_LIMIT),
    totalCount: rows.length,
    shortNoticeCount: rows.filter((row) => isShortNotice(row.startAt, args.now)).length,
  }));
};
