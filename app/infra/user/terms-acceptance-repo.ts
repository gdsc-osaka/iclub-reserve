import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { user } from "~/db/schema";
import { UserErrorCode, type TermsAcceptanceRepository, type UserError } from "~/domain/user";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った TermsAcceptanceRepository の実装。
 *
 * 同意は `user` の 2 つの列（`terms_version`・`terms_accepted_at`）に記録する。
 * 列は Better Auth の `additionalFields` で足したもので、クライアントからは書き込めない。
 */
export const createTermsAcceptanceRepository = (db: Database): TermsAcceptanceRepository => ({
  recordAcceptance: (userId, termsVersion, acceptedAt) =>
    ResultAsync.fromPromise(
      db
        .update(user)
        .set({ terms_version: termsVersion, terms_accepted_at: acceptedAt })
        .where(eq(user.id, userId))
        .returning({ id: user.id }),
      (cause): UserError => ({
        code: UserErrorCode.DatabaseError,
        message: `ユーザー ${userId} の利用規約への同意を記録できなかった。`,
        cause,
      }),
    ).andThen((rows) =>
      rows.length === 0
        ? errAsync<null, UserError>({
            code: UserErrorCode.NotFound,
            message: `ID が ${userId} のユーザーが無く、利用規約への同意を記録できなかった。`,
          })
        : okAsync(null),
    ),
});
