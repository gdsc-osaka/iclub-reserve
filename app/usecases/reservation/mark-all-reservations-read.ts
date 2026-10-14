import { okAsync, safeTry, type ResultAsync } from "neverthrow";

import {
  ReservationErrorCode,
  type ReservationError,
  type ReservationReadRepository,
} from "~/domain/reservation";
import type { QueryError } from "~/query/error";
import type { GroupUnreadUpdatesQuery } from "~/query/reservation/group-unread-updates";

export interface MarkAllReservationsReadDeps {
  readonly reservationReadRepository: ReservationReadRepository;
  readonly groupUnreadUpdatesQuery: GroupUnreadUpdatesQuery;
}

export interface MarkAllReservationsReadArgs {
  readonly actorUserId: string;
  /** そのとき一覧に出ていた予約の ID（画面から送られてくる） */
  readonly reservationIds: readonly string[];
  readonly now: Date;
}

/** 未読の読み取りの失敗を ReservationError に変換する */
const toUnreadQueryError = (error: QueryError): ReservationError => ({
  code: ReservationErrorCode.DatabaseError,
  message: "既読にする前に、未読の予約を読み取れなかった。",
  cause: error,
});

/**
 * 画面から送られてきた ID のうち、今も本人の未読に含まれるものだけを残す。
 *
 * 未読に含まれるのは、本人が全項目を見られる予約（COND-026 (2)）だけである。
 * これで、見られない予約の既読の記録を作らせない。
 * 送られてきた後に既読になったものは、書き直す必要が無いので除いてよい。
 */
const toMarkableReservationIds = (
  requestedIds: readonly string[],
  unreadIds: readonly string[],
): readonly string[] => {
  const unread = new Set(unreadIds);
  return [...new Set(requestedIds)].filter((id) => unread.has(id));
};

/**
 * 一覧に出ている予約をまとめて既読にするユースケース（UC-037 / COND-026 (5) / INFO-012）。
 *
 * ダッシュボードの「すべて確認済みにする」から呼ばれる。
 * 既読にするのは、押したときに一覧に出ていた予約だけである（一覧に出ていない「ほか n 件」は残す）。
 * 1 回の `db.batch` で一括 upsert し、`last_read_at` を後ろに戻さない。
 */
export const markAllReservationsReadUseCase = (
  deps: MarkAllReservationsReadDeps,
  args: MarkAllReservationsReadArgs,
): ResultAsync<null, ReservationError> =>
  safeTry(async function* () {
    const unread = yield* deps.groupUnreadUpdatesQuery
      .findUnreadForUser(args.actorUserId, args.now)
      .mapErr(toUnreadQueryError);

    const targetIds = toMarkableReservationIds(args.reservationIds, unread.allUnreadReservationIds);

    yield* deps.reservationReadRepository.upsertMany(args.actorUserId, targetIds, args.now);

    return okAsync(null);
  });
