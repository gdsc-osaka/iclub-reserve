/**
 * `Cache-Control` を書いていない応答に付ける既定の値。
 *
 * `wrangler.jsonc` で Workers Cache（エッジキャッシュ）を有効にしているため、
 * `Cache-Control` の無い GET の応答は、Cloudflare が勝手にキャッシュする（200 なら 2 時間、404 なら 3 分）。
 * キャッシュのキーは URL だけで、Cookie を含まない。そのまま返すと、
 * ログインした人の画面がキャッシュに残り、同じ URL を開いた別の人（ログインしていない人も）に返ってしまう。
 *
 * そこで、ルートが自分で `Cache-Control` を決めていない応答は、すべてキャッシュさせない。
 * - `private`: Workers Cache を含む、共有のキャッシュに置かせない
 * - `no-store`: ブラウザにも残させない（共用のパソコンで、ログアウトの後に「戻る」で見えないように）
 *
 * キャッシュさせたい応答（だれが見ても同じ画像など）は、ルートで `Cache-Control: public, max-age=…` を付ける。
 * 付けた値はそのまま使う。
 *
 * @see https://developers.cloudflare.com/workers/cache/configuration/#cache-control-semantics
 */
export const DEFAULT_CACHE_CONTROL = "private, no-store";

/**
 * 応答に `Cache-Control` が無ければ、既定の値（{@link DEFAULT_CACHE_CONTROL}）を付けて返す。
 * すでに付いている応答は、手を加えずにそのまま返す。
 *
 * `Response.redirect()` や `fetch()` が返す応答は、ヘッダーを書き換えられない。
 * そのため、ヘッダーを写した新しい `Response` を作って返す（本文のストリームはそのまま渡る）。
 */
export function withDefaultCacheControl(response: Response): Response {
  if (response.headers.has("Cache-Control")) {
    return response;
  }
  // WebSocket の応答（101）は作り直せない（`new Response` は 200〜599 しか受け付けない）。
  // WebSocket はキャッシュされないので、そのまま返す。
  if (response.webSocket) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
