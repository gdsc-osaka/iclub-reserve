import { ResultAsync } from "neverthrow";
import { WorkerMailer } from "worker-mailer";
import type { MailAddressee } from "~/domain/mail/mail-message";
import type { MailSender, MailSendError } from "~/domain/mail/mail-sender";
import { classifySmtpError } from "./smtp-error";

export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
};

/** ドメインの宛先を worker-mailer が受け取る形に変換する */
const toUser = (addressee: MailAddressee) => ({
  email: addressee.address.value,
  ...(addressee.name ? { name: addressee.name } : {}),
});

/**
 * worker-mailer が投げた例外を MailSendError に正規化する。
 *
 * 分類そのものは同じ infra 層の classifySmtpError に委譲し、
 * サーバーの 3 桁の応答コード（254 / 421 / 455 / 535 等）を一次情報として扱う。
 */
const toMailSendError = (cause: unknown): MailSendError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return classifySmtpError(message, cause);
};

/**
 * Oracle Email Delivery へ SMTP でメールを送る MailSender の実装。
 *
 * Cloudflare Workers 上では Nodemailer の SMTP トランスポートが動かないため
 * （node:tls に STARTTLS のソケット昇格がなく、workerd の startTls も SMTP では
 * 機能しない）、`cloudflare:sockets` を使う worker-mailer を採用している。
 */
export const createSmtpMailSender = (config: SmtpConfig): MailSender => ({
  send(message) {
    // 例外を投げる Promise を ResultAsync に変換する。
    // try/catch の代わりに fromPromise の第 2 引数で例外を MailSendError へ正規化する。
    return ResultAsync.fromPromise(
      // 接続の使い回しはしない。Workers には同時接続数の上限があり、
      // リクエストをまたいでソケットを保持できないため、1 通ごとに開いて閉じる。
      // 静的メソッドの send は connect → send → close をまとめて行う。
      WorkerMailer.send(
        {
          host: config.host,
          port: config.port,
          // 465 番は接続した時点で TLS を張る（暗黙 TLS / submissions）。
          secure: true,
          // STARTTLS（平文接続からの TLS 昇格）は workerd 側が SMTP で未対応なので必ず無効化する。
          // https://github.com/cloudflare/workerd/issues/2712
          startTls: false,
          authType: ["plain", "login"],
          credentials: { username: config.username, password: config.password },
        },
        {
          from: toUser(message.from),
          to: toUser(message.to),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        },
      ),
      toMailSendError,
    );
  },
});
