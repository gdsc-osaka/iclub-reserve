import { env } from "cloudflare:workers";

/**
 * Better Auth の baseURL から rpID（ホスト名）を求める。
 *
 * パスキーの登録・認証および WebAuthn Signal API
 * （PublicKeyCredential.signalUnknownCredential）の呼び出しに使う。
 * URL として解釈できない場合は undefined を返す。
 */
export const toRpId = (baseURL: string | undefined): string | undefined =>
  typeof baseURL === "string" && URL.canParse(baseURL) ? new URL(baseURL).hostname : undefined;

/**
 * 現在の環境のパスキー rpID を取得する。
 */
export const getPasskeyRpId = (): string => {
  const { BETTER_AUTH_URL } = env as Env & { readonly BETTER_AUTH_URL?: string };
  return toRpId(BETTER_AUTH_URL) ?? "";
};
