import { env } from "cloudflare:workers";
import { createConsoleMailSender } from "./console-mail-sender.server";
import { createSmtpMailSender } from "./smtp-mail-sender.server";
import type { MailSender } from "~/domain/mail/mail-sender";

/**
 * SMTP の認証情報（`.dev.vars` や `wrangler secret put` で渡す）。
 *
 * `wrangler types` が生成する `Env` には「今の環境に実際にある値」しか載らないため、
 * 未設定の環境では型にも現れない。未設定でも動く（コンソール出力に切り替える）のが
 * この関数の役目なので、あってもなくてもよい値として読む。
 */
type SmtpCredentials = {
  readonly SMTP_USER?: string;
  readonly SMTP_PASSWORD?: string;
};

/**
 * 実行環境に応じた MailSender を組み立てる。
 *
 * SMTP の認証情報が設定されていなければコンソール出力にフォールバックするので、
 * Oracle Email Delivery のアカウントがなくてもローカル開発を進められる。
 *
 * Workers ではバインディングがリクエスト単位で解決されるため、
 * モジュール読み込み時ではなく呼び出しごとに生成すること。
 */
export const createMailSender = (): MailSender => {
  const { SMTP_USER: username, SMTP_PASSWORD: password } = env as Env & SmtpCredentials;

  if (!username || !password) {
    console.warn(
      "SMTP_USER / SMTP_PASSWORD が未設定のため、メールを送信せずコンソールに出力します。",
    );
    return createConsoleMailSender();
  }

  return createSmtpMailSender({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    username,
    password,
  });
};

/** 環境変数から差出人を解決する */
export const getMailFrom = (): { address: string; name: string } => ({
  address: env.MAIL_FROM_ADDRESS,
  name: env.MAIL_FROM_NAME,
});
