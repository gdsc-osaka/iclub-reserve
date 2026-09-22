import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import {
  ReservationErrorCode,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";

/** 重なりを調べるために必要な依存 */
export interface ApprovedOverlapDeps {
  readonly reservationRepository: ReservationRepository;
}

/**
 * 同一施設・同一時間帯に承認済みの予約が無いかを確かめる（COND-001）。
 *
 * 重なりを禁じているのは承認済みの予約に対してだけで、仮予約どうしは重なってよい。
 * どちらを承認するかは事務局が選ぶ。
 *
 * 確認から書き込みまでの間に別の予約が承認される余地は残る。D1 では確認と書き込みを
 * 1 つのトランザクションで囲めないためで、すり抜けたときの受け止め方は呼び出し側が決める。
 * 仮予約の申請（UC-002）はすり抜けても実害が無く、承認（UC-006）では同じ条件を
 * UPDATE 文にも持ち込んで止めている。どちらの場合も、この確認は書き込みの直前に置くこと。
 *
 * 拒否したときのメッセージを引数で受け取るのは、操作によって利用者に促すことが
 * 変わるため（別の時間帯を選ぶ／先に既存の予約をキャンセルする）。
 * 何をすれば先へ進めるのかが伝わらないと、利用者は同じ操作を繰り返すことになる。
 *
 * slot は 3 項目だけを取り出し直してからポートへ渡す。呼び出し側は予約そのものを
 * 渡せばよいが、そのまま素通しすると、ポートが受け取ると宣言していない項目まで
 * リポジトリへ流れ込む。絞る場所を 1 か所に決めておかないと、呼び出しが増えるたびに
 * 絞り忘れが起きうる。
 */
export const ensureNoApprovedOverlap = (
  deps: ApprovedOverlapDeps,
  slot: ReservationOverlapArgs,
  conflictMessage: string,
): ResultAsync<null, ReservationError> =>
  deps.reservationRepository
    .existsApprovedOverlap({
      facilityId: slot.facilityId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    })
    .andThen((exists) =>
      exists
        ? errAsync<null, ReservationError>({
            code: ReservationErrorCode.ReservationConflict,
            message: conflictMessage,
          })
        : okAsync(null),
    );
