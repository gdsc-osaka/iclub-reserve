import type { ResultAsync } from "neverthrow";
import type { MailMessage } from "./mail-message";

/**
 * メール送信に失敗したことを表すエラー。
 * 送信手段（SMTP / HTTP API）に依存しない粒度に正規化しておく。
 */
export type MailSendError =
  /** SMTP サーバーに接続できなかった（ホスト名・ポート・タイムアウトなど。再試行対象） */
  | { readonly type: "connection_failed"; readonly cause: unknown }
  /** SMTP 認証に失敗した（ユーザー名・パスワードの誤り。恒久失敗） */
  | { readonly type: "auth_failed"; readonly cause: unknown }
  /** 接続・認証はできたが送信に失敗した（本文エラーなど） */
  | { readonly type: "send_failed"; readonly cause: unknown }
  /** レート制限または一時的な過負荷（421, 455, 4xx など。再試行対象） */
  | { readonly type: "rate_limited"; readonly cause: unknown }
  /** 宛先の恒久的な拒否（254 抑制リスト、5xx 宛先不在など。恒久失敗） */
  | { readonly type: "rejected"; readonly cause: unknown };

/**
 * エラーが一過性のものであり、時間を置いて再送すべきかを判定する。
 *
 * どの層でも同じ基準で再試行可否を判断できるようにドメイン層に置く。
 * infra 層に置くと consumer やユースケースが SMTP の詳細を知る必要が生じてしまうため。
 */
export const isRetryable = (error: MailSendError): boolean =>
  error.type === "connection_failed" || error.type === "rate_limited";

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
