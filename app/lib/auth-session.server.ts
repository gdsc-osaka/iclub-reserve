import { redirect } from "react-router";

import { isProfileCompleted } from "~/domain/auth/user-profile";
import { LOGIN_PATH, toCurrentPath, WELCOME_PATH, withRedirectTo } from "./auth-redirect";
import { getAuth } from "./auth.server";

/** Better Auth の `getSession` が返す値。ログインしていなければ null になる。 */
type SessionResult = Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;

/** ログイン中のユーザー。 */
export type SessionUser = NonNullable<SessionResult>["user"];

/**
 * ログイン中のユーザーを取得する。ログインしていなければ null を返す。
 *
 * ログインしていなくても表示できる画面（トップページなど）で使う。
 */
export const getSessionUser = async (request: Request): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: request.headers });

  return session?.user ?? null;
};

/**
 * ログインしていることを必須にする。していなければログイン画面へ送る。
 *
 * ローダーの中で `throw` するため、呼び出し側では戻り値をそのまま使ってよい。
 *
 * @param request ローダー・アクションが受け取ったリクエスト
 * @param redirectTo ログインを終えたあとに戻すページ。省略すると今いるページに戻す。
 */
export const requireUser = async (
  request: Request,
  redirectTo: string = toCurrentPath(request),
): Promise<SessionUser> => {
  const user = await getSessionUser(request);
  if (user) return user;

  throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));
};

/**
 * ログイン済みで、かつお名前の登録が済んでいることを必須にする。
 *
 * ログインが必要な画面のローダーではこちらを使う。
 * 認証コードでログインした直後は名前が空のままアプリに入れてしまうため、
 * その場合はセットアップ画面へ送り、終わったら元のページへ戻す。
 *
 * @param request ローダー・アクションが受け取ったリクエスト
 * @param redirectTo セットアップを終えたあとに戻すページ。省略すると今いるページに戻す。
 */
export const requireProfileCompletedUser = async (
  request: Request,
  redirectTo: string = toCurrentPath(request),
): Promise<SessionUser> => {
  const user = await requireUser(request, redirectTo);
  if (isProfileCompleted(user)) return user;

  throw redirect(withRedirectTo(WELCOME_PATH, redirectTo));
};
