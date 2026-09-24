import { createContext, redirect } from "react-router";
import type { MiddlewareFunction, RouterContextProvider } from "react-router";

import { isProfileCompleted } from "~/domain/authn/user-profile";
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
 * 利用中のセッション情報。
 * トークンはブラウザや画面コンポーネントへ渡さないため、含めない（COND-019 / 実装課題 8）。
 */
export type RequestSession = {
  readonly id: string;
  readonly createdAt: Date;
};

/**
 * ミドルウェアが調べたログイン状態を、同じリクエストのローダー・アクションへ渡す入れ物。
 *
 * React Router の「コンテキスト」はリクエストごとに独立しているため、
 * 別の人のログイン状態が混ざることはない。
 */
const sessionUserContext = createContext<SessionUser | null>(null);
const requestSessionContext = createContext<RequestSession | null>(null);

/** ローダー・アクションが受け取る `context`。 */
type LoaderContext = Readonly<RouterContextProvider>;

type AuthSessionData = {
  readonly user: SessionUser;
  readonly session: RequestSession;
} | null;

/**
 * Better Auth にセッションを問い合わせる。
 *
 * 1 リクエストにつき 1 回で済ませたいので、画面側からは呼ばない。
 * 画面側は `getRequestUser` / `requireRequestUser` および
 * `getRequestSession` / `requireRequestSession` を使うこと。
 */
const getAuthSession = async (request: Request): Promise<AuthSessionData> => {
  const result = await getAuth().api.getSession({ headers: request.headers });
  if (!result) return null;

  return {
    user: result.user,
    session: {
      id: result.session.id,
      createdAt: result.session.createdAt,
    },
  };
};

/**
 * ログインを必須にする。していなければログイン画面へ送る。
 *
 * さらに、ログイン直後でお名前がまだ空の人はセットアップ画面へ送る。
 * 認証コードでのログインは未登録のメールアドレスならその場でアカウントを作るため、
 * 名前が空のままアプリに入れてしまうのを防いでいる。
 */
const requireProfileCompletedSession = async (
  request: Request,
): Promise<NonNullable<AuthSessionData>> => {
  // ログイン・セットアップを終えたあとに戻すページ（＝今アクセスしようとしたページ）。
  const redirectTo = toCurrentPath(request);

  const data = await getAuthSession(request);
  if (!data) throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));
  if (!isProfileCompleted(data.user)) throw redirect(withRedirectTo(WELCOME_PATH, redirectTo));

  return data;
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
  const authData = isPublicPath(toCurrentPathname(request))
    ? await getAuthSession(request)
    : await requireProfileCompletedSession(request);

  context.set(sessionUserContext, authData?.user ?? null);
  context.set(requestSessionContext, authData?.session ?? null);

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

/**
 * このリクエストの利用中セッションを取り出す。ログインしていなければ null。
 *
 * @param context ローダー・アクションが受け取る `context`
 */
export const getRequestSession = (context: LoaderContext): RequestSession | null =>
  context.get(requestSessionContext);

/**
 * ログイン必須の画面で、利用中のセッション情報を取り出す。
 *
 * @param context ローダー・アクションが受け取る `context`
 */
export const requireRequestSession = (context: LoaderContext): RequestSession => {
  const session = getRequestSession(context);
  if (!session) {
    throw new Error(
      "ログインが必要な画面でセッションを取得できませんでした。isPublicPath の設定を確認してください。",
    );
  }

  return session;
};
