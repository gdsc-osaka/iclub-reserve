import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import { toReservationView, type ReservationView } from "~/domain/reservation/visibility";
import {
  ensureCanViewReservation,
  resolveReservationActor,
} from "./_shared/reservation-authorization";

export interface GetReservationDeps {
  readonly reservationRepository: ReservationRepository;
  /** 見ている人が予約の団体に所属しているかを確かめるために使う（COND-008） */
  readonly membershipRepository: MembershipRepository;
}

export interface GetReservationArgs {
  readonly reservationId: string;
  /** 予約を見ようとしているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局スタッフかどうか（COND-009） */
  readonly isStaff: boolean;
}

/**
 * 予約 1 件を、見ている人に見せてよい範囲で取得するユースケース（SCR-005 / COND-008）。
 *
 * 返すのは判別可能なユニオン（{@link ReservationView}）で、詳細を見られない相手には
 * 使用人数・備考・却下/キャンセル理由・作成者を型ごと落として渡す。
 *
 * 【所属を引くのを予約より後にしている理由】
 * どの団体の予約かは、予約を読むまで分からない。団体を引数で受け取って先に
 * 所属を確かめる形にもできるが、そうすると呼び出し側が渡した団体と
 * 予約の団体が一致するかを別に確かめることになり、そこを書き落とすと
 * 自分の団体の ID を添えるだけで他団体の予約が読めてしまう。
 *
 * NOTE: 団体名・施設名・作成者名は返していない。予約のエンティティが ID しか持たないため。
 * 画面（SCR-005）を作るときは、名前まで含んだ読み取り専用の Query を足して
 * そちらへ移すこと（ADR-001）。可視範囲の判定はこのユースケースと同じ形にすること。
 */
export const getReservationUseCase = (
  deps: GetReservationDeps,
  args: GetReservationArgs,
): ResultAsync<ReservationView, ReservationError> =>
  safeTry(async function* () {
    // 空文字や空白だけの ID は、DB へ問い合わせずに打ち切る
    const id = args.reservationId.trim();
    if (id === "") {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.ReservationNotFound,
        message: "予約 ID が指定されていません。",
      });
    }

    const reservation = yield* deps.reservationRepository.findById(id);

    /*
     * このあと判定するうちで、いちばん強い権限を要するのは詳細の閲覧なので
     * ViewDetail を渡す。事務局はこれだけで通るため、所属は引かれない。
     */
    const actor = yield* resolveReservationActor(
      deps,
      reservation.groupId,
      args,
      ReservationAction.ViewDetail,
    );

    yield* ensureCanViewReservation(actor);

    return okAsync(toReservationView(reservation, actor));
  });
