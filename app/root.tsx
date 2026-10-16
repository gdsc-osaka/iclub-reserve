import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { NavigationProgress } from "~/components/navigation-progress";
import { Toaster } from "~/components/ui/sonner";
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
  /*
   * ホーム画面に追加したときの名前・アイコン・開き方（ADR-011）。
   * どちらも public/ の静的なファイルなので、ログインしていなくても取れる。
   * アイコンは `pnpm run icons:generate` で作り直す。
   *
   * ブラウザは manifest を、ふつうは Cookie なしで取りに行く。ブランチのプレビューは
   * Cloudflare Access の内側にあり、Cookie が無いとログインへ転送されて manifest を読めず、
   * インストールできなくなる。`use-credentials` で Cookie 付きにしておく（本番でも害はない）。
   */
  { rel: "manifest", href: "/manifest.webmanifest", crossOrigin: "use-credentials" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
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
  /*
   * 画面が操作できる状態になった（ブラウザで React の読み込みが終わった）ことを、
   * <html data-hydrated="true"> という印で知らせる。
   * E2E テスト（`e2e/support/page.ts`）はこの印を待ってから操作する。
   * 読み込みが終わる前にボタンを押しても、何も起きないことがあるため。
   */
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  /*
   * Service Worker（public/sw.js）を登録する。
   * 電波が無くて画面を開けないときに「つながっていません」の画面を出すだけで、
   * 画面やデータはキャッシュしない（ADR-011）。
   *
   * 開発サーバー（`pnpm run dev`）では登録しない。localhost のポートは他のプロジェクトとも
   * 共有されるので、登録すると別のプロジェクトの画面まで、この Service Worker を通ってしまう。
   * 試すときは `pnpm run preview` でビルドしたものを開く。
   */
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Service Worker の登録に失敗しました:", error);
    });
  }, []);

  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/*
          ホーム画面から開いたときの、上の帯（ステータスバー・タイトルバー）の色。
          画面の上端の帯と同じ背景色（app.css の --background）にそろえる。

          manifest にはライト・ダーク別の色を書けないので、ここでだけ指定する。
          manifest に theme_color を書くと、Android でインストールしたアプリの
          ステータスバーがダークモードでもその色に固定される（ADR-011）。
        */}
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {/*
          操作の結果を知らせる通知（sonner）。どの画面からも toast() で出せるよう、外枠に 1 つだけ置く。
          画面上部に出すのは、スマホでは画面下にボトムナビがあり、下に出すと重なって読めないため。
        */}
        <Toaster position="top-center" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      {/*
        画面を移るあいだ、上端に出すローディングのバー。
        App はふつうの画面すべての親なので、ここに 1 つ置けば全画面で出る。
        `Layout` はエラー画面（下の ErrorBoundary）も包む外枠だが、エラー画面からは
        ふつうのリンク（<a href>）でページごと開き直すので、バーは要らない。
      */}
      <NavigationProgress />
      <Outlet />
    </>
  );
}

/**
 * どの画面でも拾えなかったエラーを最後に受け止める画面。
 *
 * ここが出るときは共通の外枠（サイドバー）も一緒に落ちているので、
 * 戻る先としてトップページへのリンクだけは必ず置いておく。
 * 画面ごとの案内を出したい場合は、そのルートに ErrorBoundary を書くこと
 * （例: app/routes/groups/$groupId/route.tsx）。
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
