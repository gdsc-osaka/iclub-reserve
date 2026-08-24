import type { ResultAsync } from "neverthrow";
import type { MailMessage } from "./mail-message";

/**
 * メール送信に失敗したことを表すエラー。
 * 送信手段（SMTP / HTTP API）に依存しない粒度に正規化しておく。
 */
export type MailSendError =
  /** SMTP サーバーに接続できなかった（ホスト名・ポート・タイムアウトなど） */
  | { readonly type: "connection_failed"; readonly cause: unknown }
  /** SMTP 認証に失敗した（ユーザー名・パスワードの誤り） */
  | { readonly type: "auth_failed"; readonly cause: unknown }
  /** 接続・認証はできたが送信に失敗した（宛先拒否・本文エラーなど） */
  | { readonly type: "send_failed"; readonly cause: unknown };

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
