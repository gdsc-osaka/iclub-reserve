import { ok, type ResultAsync, safeTry } from "neverthrow";

import { ReservationStatus, UPCOMING_RESERVATIONS_LIMIT } from "~/domain/reservation";
import type { QueryError } from "~/query/error";
import type {
  ReservationListItem,
  ReservationListQuery,
} from "~/query/reservation/reservation-list";
import type { UserGroupListQuery } from "~/query/user/user-group-list";
import { toReservationListItem } from "./_shared/to-reservation-list-item";

export interface ListUpcomingReservationsDeps {
  readonly userGroupListQuery: UserGroupListQuery;
  readonly reservationListQuery: ReservationListQuery;
}

export interface ListUpcomingReservationsArgs {
  readonly actorUserId: string;
  readonly now: Date;
}

/**
 * ダッシュボードの「今後の予約」に表示する予約一覧を取得するユースケース（SCR-022 / UC-032）。
 *
 * 利用者が所属する全団体の予約のうち、終了日時が現在以降の仮予約・承認済みの予約を、
 * 開始日時が近い順に最大 5 件取得する。
 */
export const listUpcomingReservationsUseCase = (
  deps: ListUpcomingReservationsDeps,
  args: ListUpcomingReservationsArgs,
): ResultAsync<readonly ReservationListItem[], QueryError> =>
  safeTry(async function* () {
    const groups = yield* deps.userGroupListQuery.findByUserId(args.actorUserId);
    if (groups.length === 0) {
      return ok([]);
    }

    const groupIds = groups.map((g) => g.id);
    const rows = yield* deps.reservationListQuery.findList({
      groupIds,
      statuses: [ReservationStatus.Provisional, ReservationStatus.Approved],
      facilityId: null,
      from: args.now,
      to: null,
      sort: "start_at_asc",
      limit: UPCOMING_RESERVATIONS_LIMIT,
    });

    return ok(rows.map(toReservationListItem));
  });
