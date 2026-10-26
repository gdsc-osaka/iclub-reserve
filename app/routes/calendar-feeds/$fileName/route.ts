import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";

import {
  toGroupCalendarFeedSince,
  toGroupCalendarFeedIcs,
  toInactiveGroupCalendarFeedIcs,
} from "~/domain/calendar/group-calendar-feed";
import { createDb } from "~/infra/db";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import { findGroupCalendarFeed } from "~/query/calendar/group-calendar-feed";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";

/**
 * ログインしていない要求のログ記録用固定ユーザー ID（ADR-013 決定 4）。
 * トークンをログやエラーコンテキストに含めないために使用する。
 */
const UNAUTHENTICATED_FEED_USER_ID = "unauthenticated";

/**
 * 自団体の予約カレンダー配信リソースルート（ADR-013 決定 4 / COND-029）。
 *
 * カレンダーアプリ（Google カレンダー、Apple カレンダーなど）からの HTTP GET 要求に対し、
 * 最新の予約状況から組み立てた iCal（RFC 5545）を返す。
 *
 * 【設計上の配慮】
 * 1. 認証: ログイン画面や Cookie は通らず、URL 中のトークンを秘密鍵として使用する。
 * 2. 拡張子: :fileName で受け、.ics で終わらない場合は即座に 404 を返す。
 * 3. 存在しない・無効なトークン: 予定 0 件の「無効になったカレンダー（i-Club）」を 200 で返す。
 *    404 を返すとカレンダーアプリが手元の予定を表示し続けてしまうため、正常応答で予定を消去する。
 *    見つからないことはアクセスログを埋めないようログに残さない。
 * 4. 読み取り失敗時: 一時的な障害で手元の予定を消去しないよう、0 件にせずエラー応答を返す。
 * 5. キャッシュ: private, max-age=300 で CDN 共有キャッシュを防ぎ、適度な再取得を促す。
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const fileName = params.fileName;
  if (!fileName || !fileName.endsWith(".ics")) {
    throw new Response("Not Found", { status: 404 });
  }

  const token = fileName.slice(0, -4);
  if (token === "") {
    throw new Response("Not Found", { status: 404 });
  }

  const db = createDb(env.DB);
  const now = new Date();
  const since = toGroupCalendarFeedSince(now);

  const result = await findGroupCalendarFeed(db, { token, since });

  if (result.isErr()) {
    throw queryErrorResponse(
      { where: "calendar-feeds.loader", userId: UNAUTHENTICATED_FEED_USER_ID },
      result.error,
    );
  }

  const baseUrl = resolveAppBaseUrl(request);
  const icsBody =
    result.value !== null
      ? toGroupCalendarFeedIcs({
          groupName: result.value.groupName,
          reservations: result.value.reservations,
          baseUrl,
        })
      : toInactiveGroupCalendarFeedIcs();

  return new Response(icsBody, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
