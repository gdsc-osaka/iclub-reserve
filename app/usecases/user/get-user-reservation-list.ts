import { errAsync, type ResultAsync } from "neverthrow";

import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  UserReservationList,
  UserReservationListQuery,
} from "~/query/user/user-reservation-list";

/** 履歴として既定で表示する件数 */
export const DEFAULT_PAST_RESERVATION_LIMIT = 20;

export interface GetUserReservationListDeps {
  readonly userReservationListQuery: UserReservationListQuery;
}

export interface GetUserReservationListArgs {
  /**
   * 一覧を見ようとしている人。**必ずセッションから取った ID を渡すこと**。
   *
   * このユースケースは「この人が所属する団体の予約」を返す。
   * URL やフォームの値をそのまま渡すと、他人の予約を読ませることになる。
   */
  readonly viewerUserId: string;
  /** 「これから」と「履歴」を分ける基準時刻。呼び出し側で `new Date()` を作って渡す */
  readonly now: Date;
  /** 履歴の表示件数。省略時は `DEFAULT_PAST_RESERVATION_LIMIT` */
  readonly pastLimit?: number;
}

/**
 * 自分が所属する団体の予約一覧を取得するユースケース (SCR-003 の団体側 / REQ-003)。
 *
 * 所属の確認をここで書いていないのは、手を抜いたからではない。
 * このユースケースが使う Query は member を内部結合して
 * 「渡した userId が所属する団体」だけに絞り込んでいるので、
 * 他団体の予約は問い合わせの形として最初から取得できない。
 * 判定を足しても二重になるだけで、守れる範囲は変わらない。
 *
 * 逆に言うと、この安全性は `viewerUserId` にセッションのユーザーが渡ることに
 * 全面的に依存している。呼び出し側は必ず `requireRequestUser` の結果を渡すこと。
 *
 * 団体 ID を指定して 1 団体分だけを見る画面を作るときは、この形は使えない。
 * そちらは「その団体に所属しているか」を `canPerform` で判定する必要がある
 * (docs/adr/001-read-model-separation.md の決定 7)。
 */
export const getUserReservationListUseCase = (
  deps: GetUserReservationListDeps,
  args: GetUserReservationListArgs,
): ResultAsync<UserReservationList, QueryError> => {
  const viewerUserId = args.viewerUserId.trim();

  // ここに来る時点でログイン済みのはずなので、空なら呼び出し側の間違い。
  // 空文字のまま問い合わせると「所属が 0 件の人」として静かに空一覧を返してしまい、
  // 不具合が「予約がありません」という正常な画面に化けて気づけなくなる。
  if (viewerUserId === "") {
    return errAsync<UserReservationList, QueryError>({
      code: QueryErrorCode.Forbidden,
      message: "閲覧者を特定できませんでした。",
    });
  }

  // 0 件や負の件数は SQL に渡す前に既定値へ寄せる (LIMIT が壊れるため)
  const requestedLimit = args.pastLimit;
  const pastLimit =
    requestedLimit === undefined || requestedLimit < 1
      ? DEFAULT_PAST_RESERVATION_LIMIT
      : Math.trunc(requestedLimit);

  return deps.userReservationListQuery.findByUserId(viewerUserId, { now: args.now, pastLimit });
};
