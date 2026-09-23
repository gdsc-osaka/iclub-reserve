import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import {
  UserErrorCode,
  type SessionRevoker,
  type UserError,
  type UserSessionRepository,
} from "~/domain/user";

export interface RevokeSessionDeps {
  readonly userSessionRepository: UserSessionRepository;
  readonly sessionRevoker: SessionRevoker;
}

export interface RevokeSessionArgs {
  readonly userId: string;
  /** フォームから届いた、ログアウトさせたいセッションの ID */
  readonly sessionId: string;
  /** 利用中のセッションの ID */
  readonly currentSessionId: string;
}

/**
 * ログイン中の端末を 1 台ログアウトさせるユースケース（UC-031）。
 *
 * 利用中の端末は、一覧からはログアウトさせない（通常のログアウトを使う）。
 * 利用中の端末かどうかは ID を比べるだけで分かるので、DB を引く前に止める。
 *
 * 他人のセッションの ID を送られた場合は、無い場合と同じ `SessionNotFound` を返す。
 * 他人のセッションがあるかどうかを答える理由は無いため。
 */
export const revokeSessionUseCase = (
  deps: RevokeSessionDeps,
  args: RevokeSessionArgs,
): ResultAsync<null, UserError> =>
  safeTry(async function* () {
    if (args.sessionId === args.currentSessionId) {
      return errAsync<never, UserError>({
        code: UserErrorCode.CurrentSession,
        message: `利用中のセッション ${args.sessionId} を一覧からログアウトさせようとした。`,
        userMessage:
          "利用中の端末は、ここからはログアウトできません。通常のログアウトをご利用ください。",
      });
    }

    const token = yield* deps.userSessionRepository.findOwnSessionToken(
      args.userId,
      args.sessionId,
    );
    if (token === null) {
      return errAsync<never, UserError>({
        code: UserErrorCode.SessionNotFound,
        message: `ユーザー ${args.userId} のセッション ${args.sessionId} が無い。`,
      });
    }

    yield* deps.sessionRevoker.revoke(token);

    return okAsync(null);
  });

export interface RevokeOtherSessionsDeps {
  readonly sessionRevoker: SessionRevoker;
}

/**
 * 利用中の端末以外をすべてログアウトさせるユースケース（UC-031）。
 */
export const revokeOtherSessionsUseCase = (
  deps: RevokeOtherSessionsDeps,
): ResultAsync<null, UserError> => deps.sessionRevoker.revokeOthers().map(() => null);
