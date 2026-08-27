import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  EMAIL_DOMAIN_NOT_ALLOWED_CODE,
} from "~/domain/auth/allowed-email-domain";

/**
 * Better Auth のクライアントが返すエラー。
 *
 * `authClient.xxx()` の戻り値 `{ data, error }` の `error` に入っている形。
 */
export type AuthClientError = {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly status?: number | undefined;
};

/**
 * Better Auth のエラーコードと、画面に出す日本語メッセージの対応表。
 *
 * コードは better-auth の emailOTP プラグインが返すもの。
 * 未知のコードは呼び出し側が渡す fallback を使う。
 */
const MESSAGES: Record<string, string> = {
  INVALID_OTP: "認証コードが正しくありません。入力内容を確認してください。",
  OTP_EXPIRED: "認証コードの有効期限が切れました。もう一度送信してください。",
  TOO_MANY_ATTEMPTS:
    "認証に何度も失敗したため、このコードは無効になりました。もう一度送信してください。",
  INVALID_EMAIL: "メールアドレスの形式が正しくありません。",
  USER_NOT_FOUND: "このメールアドレスは登録されていません。",
  [EMAIL_DOMAIN_NOT_ALLOWED_CODE]: `${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスでのみご利用いただけます。`,
};

/**
 * Better Auth のエラーを日本語のメッセージに変換する。
 *
 * Better Auth のメッセージは英語なのでそのままは表示せず、
 * 対応表にない場合は呼び出し側で用意した fallback を返す。
 *
 * @param error Better Auth が返したエラー（`{ data, error }` の error）
 * @param fallback 対応表にないときに表示するメッセージ
 */
export const toAuthErrorMessage = (
  error: AuthClientError | null | undefined,
  fallback: string,
): string => {
  if (!error) return fallback;

  // 429 は Better Auth のレート制限。コードが付かないのでステータスで判定する。
  if (error.status === 429) {
    return "リクエストが多すぎます。しばらく待ってからもう一度お試しください。";
  }

  return (error.code && MESSAGES[error.code]) ?? fallback;
};
