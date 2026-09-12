import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { getRequestUser, requireAuthentication } from "~/lib/auth/auth-session.server";

import type { Route } from "./+types/root";
import "./app.css";

/**
 * すべての画面に共通で適用する処理。
 *
 * root はすべての画面の親なので、ここに置いたミドルウェアは必ず実行される。
 * `requireAuthentication` は「ログインなしで開ける画面」以外をすべてログイン必須にする。
 * 詳しくは `app/lib/auth-redirect.ts` の `isPublicPath` を参照。
 */
export const middleware: Route.MiddlewareFunction[] = [requireAuthentication];

/**
 * すべての画面で使う共通データ（今ログインしている人）を渡す。
 *
 * 併せて、上のミドルウェアを必ず実行させる役割も持つ。
 * React Router は「ローダーが 1 つもない画面」への画面内リンク遷移では
 * サーバーへ問い合わせないため、root にローダーがないと
 * その遷移だけログインの確認をすり抜けてしまう。
 */
export function loader({ context }: Route.LoaderArgs) {
  return { user: getRequestUser(context) };
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * どの画面でも拾えなかったエラーを最後に受け止める画面。
 *
 * ここが出るときは共通の外枠（サイドバー）も一緒に落ちているので、
 * 戻る先としてトップページへのリンクだけは必ず置いておく。
 * 画面ごとの案内を出したい場合は、そのルートに ErrorBoundary を書くこと
 * （例: app/routes/groups.tsx）。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "エラーが発生しました";
  let details = "時間をおいて、もう一度お試しください。";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    const isNotFound = error.status === 404;
    message = isNotFound ? "ページが見つかりません" : "エラーが発生しました";
    details = isNotFound
      ? "URL が間違っているか、このページは削除された可能性があります。"
      : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    // 開発中だけ、原因が分かるように内容をそのまま出す
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
      <a href="/" className="text-sm text-primary underline underline-offset-4">
        ホームへ戻る
      </a>
    </main>
  );
}
