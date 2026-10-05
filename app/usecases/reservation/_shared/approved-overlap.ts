import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import {
  ReservationErrorCode,
  ReservationField,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";

/**
 * 承認済みの予約と重なったときに利用者へ出す文言（COND-001）。
 *
 * 書き込む前の確認と、書き込みの条件で止まったときの両方で同じ文言を出す。
 * 利用者から見ればどちらも「その時間帯はもう埋まっている」で、違いは見分けられないため。
 * 申請（UC-002）と違って「先にキャンセル」を促すのは、事務局はその予約をキャンセルできるため。
 * 事務局による直接作成（UC-008）と直接変更（UC-008）の両方で使う。
 */
export const APPROVED_OVERLAP_MESSAGE =
  "選んだ時間帯には、すでに承認済みの予約が入っています。先にその予約をキャンセルするか、別の時間帯を選んでください。";

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
 * UPDATE 文に、直接作成（UC-008）では INSERT 文に持ち込んで止めている。
 * どの場合も、この確認は書き込みの直前に置くこと。
 *
 * 拒否したときに利用者へ出す文言を引数で受け取るのは、操作によって利用者に促すことが
 * 変わるため（別の時間帯を選ぶ／先に既存の予約をキャンセルする）。
 * 何をすれば先へ進めるのかが伝わらないと、利用者は同じ操作を繰り返すことになる。
 *
 * 重なりは時間帯の問題なので、`field` に利用時間を入れておく。
 * 時間帯の欄がある画面（申請フォーム）ではその下に出て、無い画面（一覧）ではフォームの上に出る。
 *
 * slot はポートが受け取る項目だけを取り出し直してから渡す。呼び出し側は予約そのものを
 * 渡せばよいが、そのまま素通しすると、ポートが受け取ると宣言していない項目まで
 * リポジトリへ流れ込む。絞る場所を 1 か所に決めておかないと、呼び出しが増えるたびに
 * 絞り忘れが起きうる。
 *
 * 承認済みの予約の施設・日時を変えるとき（UC-005）は、`excludeReservationId` に変える予約自身を渡す。
 * 渡さないと、動かす前の自分自身と重なって必ず拒まれる。
 */
export const ensureNoApprovedOverlap = (
  deps: ApprovedOverlapDeps,
  slot: ReservationOverlapArgs,
  userMessage: string,
): ResultAsync<null, ReservationError> =>
  deps.reservationRepository
    .existsApprovedOverlap({
      facilityId: slot.facilityId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      excludeReservationId: slot.excludeReservationId,
    })
    .andThen((exists) =>
      exists
        ? errAsync<null, ReservationError>({
            code: ReservationErrorCode.Conflict,
            field: ReservationField.Period,
            message: `施設 ${slot.facilityId} の同じ時間帯に、承認済みの予約がある。`,
            userMessage,
          })
        : okAsync(null),
    );
