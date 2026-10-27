import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  type ReservationError,
  type ReservationReadRepository,
  type ReservationRepository,
} from "~/domain/reservation";
import { canViewReservationDetail } from "~/domain/reservation/visibility";
import { resolveReservationActor } from "./_shared/reservation-authorization";

export interface MarkReservationReadDeps {
  readonly reservationReadRepository: ReservationReadRepository;
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface MarkReservationReadArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  readonly now: Date;
}

/**
 * 予約 1 件を既読にするユースケース（INFO-012 / COND-026 (5)）。
 *
 * 予約詳細（SCR-005）を開いたとき（UC-034）、予約にメッセージを送ったとき（UC-009）、
 * ダッシュボードで確認済みにしたとき（UC-037）に呼ぶ。
 *
 * 対象の予約の全項目を見られない人（COND-008 の (1)。自団体のメンバーと事務局以外）の
 * 書き込みは拒否する。
 * `last_read_at` は後ろに戻さない upsert とする。
 */
export const markReservationReadUseCase = (
  deps: MarkReservationReadDeps,
  args: MarkReservationReadArgs,
): ResultAsync<null, ReservationError> =>
  safeTry(async function* () {
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    const actor = yield* resolveReservationActor(
      { membershipRepository: deps.membershipRepository },
      reservation.groupId,
      { actorUserId: args.actorUserId, isStaff: args.isStaff },
    );

    if (!canViewReservationDetail(actor)) {
      return errAsync<null, ReservationError>({
        code: ReservationErrorCode.Forbidden,
        message: `予約の全項目を見る権限がないため、既読の記録を拒否した (${ReservationAction.ViewDetail})。`,
        userMessage: "予約の詳細を閲覧する権限がありません。",
      });
    }

    yield* deps.reservationReadRepository.upsert(args.actorUserId, args.reservationId, args.now);

    return okAsync(null);
  });
