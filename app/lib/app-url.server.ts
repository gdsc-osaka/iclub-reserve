import { env } from "cloudflare:workers";

/**
 * 実行環境の設定値（`.dev.vars` や `wrangler secret put` で渡す）。
 *
 * `wrangler types` が生成する `Env` には「今の環境に実際にある値」しか載らない。
 * シークレットは CI には存在せず型にも現れないため、ここで形だけ宣言して読む。
 */
type AppUrlSecrets = { readonly BETTER_AUTH_URL?: string };

/**
 * 招待メール等に記載する、このアプリの絶対 URL の基底（origin）を解決する。
 *
 * 【なぜリクエストの URL を第一候補にしないのか】
 * Cloudflare Workers では request.url のホスト名はクライアントから送られた Host ヘッダーに従う。
 * これをそのままメール本文に載せると、Host ヘッダー偽装攻撃によりリンクの飛び先を第三者の悪意ある
 * サイトに向けられてしまう危険がある。そのため、環境変数（設定値）を最優先で確認する。
 *
 * 【なぜフォールバックを残すのか】
 * BETTER_AUTH_URL はシークレットとして設定されるため、未設定のローカル開発環境でも
 * 招待作成とメール送信の流れを最後まで動作確認できるようにするため。
 */
export const resolveAppBaseUrl = (request: Request): string => {
  const authUrl = (env as Env & AppUrlSecrets).BETTER_AUTH_URL;
  if (typeof authUrl === "string" && URL.canParse(authUrl)) {
    return new URL(authUrl).origin;
  }
  return new URL(request.url).origin;
};
