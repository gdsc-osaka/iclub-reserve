import { createContext, redirect } from "react-router";
import type { MiddlewareFunction, RouterContextProvider } from "react-router";

import { isProfileCompleted } from "~/domain/auth/user-profile";
import {
  isPublicPath,
  LOGIN_PATH,
  toCurrentPath,
  toCurrentPathname,
  WELCOME_PATH,
  withRedirectTo,
} from "./auth-redirect";
import { getAuth } from "./auth.server";

/** Better Auth の `getSession` が返す値。ログインしていなければ null になる。 */
type SessionResult = Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;

/** ログイン中のユーザー。 */
export type SessionUser = NonNullable<SessionResult>["user"];

/**
 * ミドルウェアが調べたログイン状態を、同じリクエストのローダー・アクションへ渡す入れ物。
 *
 * React Router の「コンテキスト」はリクエストごとに独立しているため、
 * 別の人のログイン状態が混ざることはない。
 */
const sessionUserContext = createContext<SessionUser | null>(null);

/** ローダー・アクションが受け取る `context`。 */
type LoaderContext = Readonly<RouterContextProvider>;

/**
 * Better Auth にセッションを問い合わせる。
 *
 * 1 リクエストにつき 1 回で済ませたいので、画面側からは呼ばない。
 * 画面側は `getRequestUser` / `requireRequestUser` を使うこと。
 */
const getSessionUser = async (request: Request): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: request.headers });

  return session?.user ?? null;
};

/**
 * ログインを必須にする。していなければログイン画面へ送る。
 *
 * さらに、ログイン直後でお名前がまだ空の人はセットアップ画面へ送る。
 * 認証コードでのログインは未登録のメールアドレスならその場でアカウントを作るため、
 * 名前が空のままアプリに入れてしまうのを防いでいる。
 */
const requireProfileCompletedUser = async (request: Request): Promise<SessionUser> => {
  // ログイン・セットアップを終えたあとに戻すページ（＝今アクセスしようとしたページ）。
  const redirectTo = toCurrentPath(request);

  const user = await getSessionUser(request);
  if (!user) throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));
  if (!isProfileCompleted(user)) throw redirect(withRedirectTo(WELCOME_PATH, redirectTo));

  return user;
};

/**
 * ログインを必須にするミドルウェア。`app/root.tsx` から使う。
 *
 * root はすべての画面の親なので、ここを通らずに開ける画面はない。
 * そのため「`isPublicPath` で許可した画面以外はすべてログインが必要」を
 * 1 か所で実現できる。新しく画面を足しても自動で守られる。
 *
 * ミドルウェアはローダー・アクションより先に走るので、
 * ログインしていない人のリクエストでデータの読み書きが始まることもない。
 *
 * 調べたログイン状態はコンテキストに入れておき、
 * 各画面では `getRequestUser` / `requireRequestUser` で受け取る。
 */
export const requireAuthentication: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const user = isPublicPath(toCurrentPathname(request))
    ? await getSessionUser(request)
    : await requireProfileCompletedUser(request);

  context.set(sessionUserContext, user);

  return next();
};

/**
 * このリクエストのログイン中ユーザーを取り出す。ログインしていなければ null。
 *
 * ログインなしでも開ける画面（ログイン画面など）で使う。
 * ミドルウェアが調べた結果を読むだけなので、何度呼んでも追加の問い合わせは起きない。
 *
 * @param context ローダー・アクションが受け取る `context`
 */
export const getRequestUser = (context: LoaderContext): SessionUser | null =>
  context.get(sessionUserContext);

/**
 * ログイン必須の画面で、ログイン中のユーザーを取り出す。
 *
 * ミドルウェアが先に確認しているので、ここで null になることはない。
 * もし null なら、その画面を誤って `isPublicPath` の許可リストに入れている。
 *
 * @param context ローダー・アクションが受け取る `context`
 */
export const requireRequestUser = (context: LoaderContext): SessionUser => {
  const user = getRequestUser(context);
  if (!user) {
    throw new Error(
      "ログインが必要な画面でユーザーを取得できませんでした。isPublicPath の設定を確認してください。",
    );
  }

  return user;
};
