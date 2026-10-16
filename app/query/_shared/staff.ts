import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { QueryErrorCode, type QueryError } from "../error";

/**
 * 事務局だけが見られる読み取りの門番（COND-009）。
 *
 * 事務局でなければ、問い合わせを始める前に Forbidden で止める。
 * 読み取りごとに違うのはログ用の説明だけなので、それを引数で受け取る（ADR-012 決定 4）。
 *
 * @param message ログに残す説明。「事務局ではない人が、〇〇を取得しようとした。」の形で書く
 */
export const ensureStaff = (isStaff: boolean, message: string): ResultAsync<null, QueryError> =>
  isStaff ? okAsync(null) : errAsync({ code: QueryErrorCode.Forbidden, message });
