/** ログに残せる失敗の形。ドメイン・Query どちらのエラーもこの形を満たす。 */
interface LoggableError {
  readonly code: string;
  readonly message: string;
  /** 元となった例外。画面には出さず、ここでだけ残す */
  readonly cause?: unknown;
}

/**
 * サーバー側にだけ失敗の中身を残す。
 *
 * 画面に出す文言は「利用者にできること」だけに絞っているため（`action-error.ts`）、
 * ここで残さないと原因を追う手がかりがどこにも残らない。
 * `wrangler.jsonc` の `observability` を有効にしてあるので、`console.error` の出力は
 * Cloudflare のダッシュボードから読める。
 *
 * @param where どの処理で起きたか（例: `"reservations.loader"`）。ログを絞り込む目印
 */
export const logServerError = (where: string, error: LoggableError): void => {
  if (error.cause !== undefined) {
    console.error(`[${where}] ${error.code}: ${error.message}`, error.cause);
    return;
  }

  console.error(`[${where}] ${error.code}: ${error.message}`);
};
