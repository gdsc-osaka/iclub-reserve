import { eq, sql } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { user } from "~/db/schema";
import { UserErrorCode, type TermsAcceptanceRepository, type UserError } from "~/domain/user";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った TermsAcceptanceRepository の実装。
 *
 * 同意は `user` の 2 つの列（`terms_version`・`terms_accepted_at`）に記録する。
 * 列は Better Auth の `additionalFields` で足したもので、クライアントからは書き込めない。
 *
 * 同じ版にもう一度同意した場合（2 つのタブから送った・送り直したなど）は、最初に同意した日時を残す。
 * 画面で判定してから書くと、同時に届いた 2 つの送信が両方とも「まだ同意していない」と見てしまうので、
 * 更新文の中で今の値と比べる。今の値が NULL のときは `=` が NULL になり、ELSE の側（新しい日時）を選ぶ。
 */
export const createTermsAcceptanceRepository = (db: Database): TermsAcceptanceRepository => ({
  recordAcceptance: (userId, termsVersion, acceptedAt) =>
    ResultAsync.fromPromise(
      db
        .update(user)
        .set({
          terms_version: termsVersion,
          terms_accepted_at: sql`CASE WHEN ${user.terms_version} = ${termsVersion} THEN ${user.terms_accepted_at} ELSE ${acceptedAt.getTime()} END`,
        })
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
