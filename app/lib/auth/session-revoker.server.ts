import { ResultAsync } from "neverthrow";

import { UserErrorCode, type SessionRevoker, type UserError } from "~/domain/user";
import { getAuth } from "./auth.server";

/**
 * Better Auth でセッションを終わらせる SessionRevoker を作る。
 *
 * Better Auth は「誰の操作か」をリクエストのクッキーから読むので、そのリクエストのヘッダーを渡す。
 * どちらの API も、ログイン中のユーザー自身のセッションしか終わらせない。
 *
 * @param headers action が受け取ったリクエストのヘッダー
 */
export const createSessionRevoker = (headers: Headers): SessionRevoker => {
  const toUserError =
    (message: string) =>
    (cause: unknown): UserError => ({
      code: UserErrorCode.DatabaseError,
      message,
      cause,
    });

  return {
    revoke: (token) =>
      ResultAsync.fromPromise(
        getAuth().api.revokeSession({ body: { token }, headers }),
        toUserError("セッションを終わらせられなかった。"),
      ).map(() => undefined),

    revokeOthers: () =>
      ResultAsync.fromPromise(
        getAuth().api.revokeOtherSessions({ headers }),
        toUserError("ほかの端末のセッションを終わらせられなかった。"),
      ).map(() => undefined),
  };
};
