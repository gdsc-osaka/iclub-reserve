import type { Result } from "neverthrow";

import type { SessionUser } from "~/lib/auth/auth-session.server";
import type { QueryError } from "~/query/error";
import { logQueryError } from "~/routes/_shared/query-error.server";

/**
 * 区画を 1 つ読む。
 *
 * 読めなければログに残したうえで null を返す。例外にはしない。
 * 各区画のコンポーネントが「読めなかった」案内を出す。
 */
export const loadSection = async <T>(
  where: string,
  user: SessionUser,
  read: PromiseLike<Result<T, QueryError>>,
): Promise<T | null> => {
  const result = await read;
  if (result.isErr()) {
    logQueryError({ where, userId: user.id }, result.error);
    return null;
  }
  return result.value;
};
