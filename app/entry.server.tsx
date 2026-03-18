/**
 * Cloudflare Workers 対応のサーバーエントリー。
 * Node.js 専用の renderToPipeableStream ではなく、
 * Web Streams API の renderToReadableStream を使用する。
 */
import { renderToReadableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";
import { isbot } from "isbot";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const userAgent = request.headers.get("user-agent");
  const isBot = userAgent ? isbot(userAgent) : false;

  let status = responseStatusCode;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        console.error(error);
        status = 500;
      },
    },
  );

  // ボットの場合は全コンテンツが揃うまで待機
  if (isBot) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}
