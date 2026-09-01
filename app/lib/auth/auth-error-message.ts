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
 * コードは better-auth の emailOTP プラグインと passkey プラグインが返すもの。
 * パスキーの方は、サーバーが返すコード（`PREVIOUSLY_REGISTERED` など）と、
 * ブラウザ側で起きた失敗を表すコード（`ERROR_` で始まるもの）の 2 種類がある。
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

  // ここからパスキー。
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    "この端末にはすでにパスキーを登録済みです。そのままログインにお使いいただけます。",
  PREVIOUSLY_REGISTERED:
    "この端末にはすでにパスキーを登録済みです。そのままログインにお使いいただけます。",
  ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT:
    "この端末はパスキーの保存に対応していません。メールの認証コードをご利用ください。",
  ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT:
    "この端末で本人確認（顔認証・指紋・画面ロック）を行えませんでした。設定をご確認ください。",
  CHALLENGE_NOT_FOUND: "時間が経ちすぎたため、やり直しが必要です。もう一度お試しください。",
  FAILED_TO_VERIFY_REGISTRATION: "パスキーを登録できませんでした。もう一度お試しください。",
  AUTHENTICATION_FAILED: "パスキーで認証できませんでした。もう一度お試しください。",
  PASSKEY_NOT_FOUND: "このパスキーは登録されていません。メールの認証コードをご利用ください。",
};

/**
 * 「利用者がやめただけ」を表すエラーコード。
 *
 * パスキーのダイアログを閉じるのは失敗ではなく、やめるという意思表示。
 * ここに挙げたコードは赤いエラーとして出さず、黙って元の画面に戻すこと。
 * 「操作をやめただけなのに壊れた」と誤解させないための扱い。
 */
const CANCELLED_CODES: ReadonlySet<string> = new Set([
  /**
   * ブラウザが投げる `NotAllowedError`。
   *
   * ダイアログを閉じたときのほか、時間切れになったときもこれになる。
   * @simplewebauthn/browser は原因を絞り込まずそのまま通すため、
   * 「やめた」を表す代表的なコードは（名前に反して）これ。
   */
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  // 画面の切り替えなどで、こちらから操作を打ち切った場合。
  "ERROR_CEREMONY_ABORTED",
  // Better Auth 側が「やめた」とみなした場合。
  "AUTH_CANCELLED",
  "REGISTRATION_CANCELLED",
]);

/**
 * パスキーの操作を利用者がやめただけかどうか。
 *
 * true のときはエラーを表示せず、静かに元の状態へ戻す。
 *
 * @param error Better Auth が返したエラー（`{ data, error }` の error）
 */
export const isPasskeyCancelledError = (error: AuthClientError | null | undefined): boolean =>
  error?.code !== undefined && CANCELLED_CODES.has(error.code);

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
