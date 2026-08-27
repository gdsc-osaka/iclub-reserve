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
    <html lang="en">
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
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
    </main>
  );
}
