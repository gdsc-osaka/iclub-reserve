/**
 * E2E テストの実行環境の決めごと。
 *
 * `playwright.config.ts`・準備のスクリプト（`e2e/prepare.ts`）・各テストが
 * 同じ値を見るよう、ここに 1 か所で書く。
 */

/**
 * E2E 用のローカルの状態（D1・R2 など）を置くフォルダ。
 *
 * 開発用（`.wrangler/state`）とは分け、テストのたびに消して作り直す。
 * `pnpm run dev` で作ったデータを E2E が壊さないようにするため。
 */
export const E2E_PERSIST_TO = ".wrangler/e2e-state";

/**
 * E2E のアプリを起動するポート。
 *
 * 開発サーバー（5173）と別にしておくと、開発サーバーを止めずに E2E を動かせる。
 * 4173 は `vite preview` の既定のポート。
 */
export const E2E_PORT = 4173;

/** E2E のアプリの URL。Better Auth の `BETTER_AUTH_URL` にもこの値を渡す */
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * E2E のアプリで使う Better Auth の秘密鍵。
 *
 * テスト側でも同じ値でログイン用の Cookie に署名する（`e2e/support/auth.ts`）。
 * 手元の E2E のアプリでしか使わない値なので、リポジトリに書いてよい。
 * 本番やプレビューの値とは関係がない。
 */
export const E2E_AUTH_SECRET = "e2e-only-secret-do-not-use-outside-local-tests";
