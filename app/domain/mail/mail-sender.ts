import type { ResultAsync } from "neverthrow";
import type { BaseError } from "~/domain/error";
import type { MailMessage } from "./mail-message";

/**
 * メール送信に失敗した理由。
 * 送信手段（SMTP / HTTP API）に依存しない粒度に正規化しておく。
 */
export const MailSendErrorCode = {
  /** SMTP サーバーに接続できなかった（ホスト名・ポート・タイムアウトなど）。再試行対象 */
  ConnectionFailed: "CONNECTION_FAILED",
  /** SMTP 認証に失敗した（ユーザー名・パスワードの誤り）。恒久失敗 */
  AuthFailed: "AUTH_FAILED",
  /** 接続・認証はできたが送信に失敗した（本文エラーなど） */
  SendFailed: "SEND_FAILED",
  /** レート制限または一時的な過負荷（421, 455 など 4xx）。再試行対象 */
  RateLimited: "RATE_LIMITED",
  /** 宛先の恒久的な拒否（254 抑制リスト、5xx 宛先不在など）。恒久失敗 */
  Rejected: "REJECTED",
} as const;
export type MailSendErrorCode = (typeof MailSendErrorCode)[keyof typeof MailSendErrorCode];

/** メール送信に失敗したことを表すエラー */
export interface MailSendError extends BaseError {
  readonly code: MailSendErrorCode;
}

/**
 * エラーが一過性のものであり、時間を置いて再送すべきかを判定する。
 *
 * どの層でも同じ基準で再試行可否を判断できるようにドメイン層に置く。
 * ここを呼ぶ側が code を直接見に行くと、再試行の方針が呼び出し箇所の数だけ増えてしまう。
 */
export const isRetryable = (error: MailSendError): boolean =>
  error.code === MailSendErrorCode.ConnectionFailed || error.code === MailSendErrorCode.RateLimited;

/**
 * メール送信のポート（インターフェース）。
 *
 * ドメイン層に置くことで、UseCase 層は具体的な送信手段
 * （Oracle Email Delivery への SMTP、将来的な HTTP API など）を一切知らずに済む。
 * 実装は infra 層に置く。
 *
 * 戻り値は `Promise<Result<...>>` ではなく neverthrow の `ResultAsync`。
 * `map` / `andThen` で await を挟まずに繋げられる。
 * 最終的な成否を見たいときは `await` すれば `Result` が得られる。
 */
export interface MailSender {
  send(message: MailMessage): ResultAsync<void, MailSendError>;
}
