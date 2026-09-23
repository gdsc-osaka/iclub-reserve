import { and, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { session } from "~/db/schema";
import { UserErrorCode, type UserError, type UserSessionRepository } from "~/domain/user";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った UserSessionRepository の実装。
 */
export const createUserSessionRepository = (db: Database): UserSessionRepository => ({
  /*
   * 利用者の ID も条件に入れて引く。ID だけで引いてから持ち主を比べると、
   * 他人のセッションのトークンを一度はこちらの手に取ることになるため。
   */
  findOwnSessionToken: (userId, sessionId) =>
    ResultAsync.fromPromise(
      db
        .select({ token: session.token })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
        .limit(1),
      (cause): UserError => ({
        code: UserErrorCode.DatabaseError,
        message: `ユーザー ${userId} のセッション ${sessionId} を読めなかった。`,
        cause,
      }),
    ).map((rows) => rows.at(0)?.token ?? null),
});
