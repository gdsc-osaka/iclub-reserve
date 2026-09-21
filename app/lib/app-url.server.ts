import { env } from "cloudflare:workers";

import { toMailableOrigin } from "./app-url";

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
 * 【なぜリクエストの URL を使わないのか】
 * Cloudflare Workers では request.url のホスト名はクライアントから送られた Host ヘッダーに従う。
 * これをそのままメール本文に載せると、Host ヘッダーを差し替えられる経路から
 * 招待リンクの飛び先を攻撃者の用意した origin に向けられてしまう。
 * そのため、設定値（BETTER_AUTH_URL）を唯一の正とする。
 *
 * 【ローカルだけリクエストの origin に落とす理由】
 * BETTER_AUTH_URL はシークレットなので、設定していない手元の環境でも
 * 招待の作成からメールの中身までを一通り確認できるようにしておきたい。
 * 逆に preview・production でここへ落ちるのは設定漏れであり、
 * 偽装されうる origin をメールに載せるくらいなら、操作を失敗させて気付けるようにする。
 */
export const resolveAppBaseUrl = (request: Request): string => {
  const { BETTER_AUTH_URL } = env as Env & AppUrlSecrets;

  const configured = toMailableOrigin(BETTER_AUTH_URL);
  if (configured !== null) return configured;

  if (env.APP_ENV !== "local") {
    throw new Error(
      `BETTER_AUTH_URL が未設定か http(s) の URL ではないため、招待リンクを組み立てられません (APP_ENV=${env.APP_ENV})`,
    );
  }

  return new URL(request.url).origin;
};
