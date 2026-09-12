import { env } from "cloudflare:workers";
import { createConsoleMailSender } from "./console-mail-sender.server";
import { createDiscordMailSender } from "./discord-mail-sender.server";
import { createSmtpMailSender } from "./smtp-mail-sender.server";
import type { MailSender } from "~/domain/mail/mail-sender";

/**
 * メール送信まわりの秘密情報（`.dev.vars` や `wrangler secret put` で渡す）。
 *
 * `wrangler types` が生成する `Env` には「今の環境に実際にある値」しか載らないため、
 * 未設定の環境では型にも現れない。未設定でも動く（コンソール出力に切り替える）のが
 * この関数の役目なので、あってもなくてもよい値として読む。
 */
type MailSecrets = {
  readonly SMTP_USER?: string;
  readonly SMTP_PASSWORD?: string;
  /** Discord の Webhook URL。知っていれば誰でも投稿できるので秘密として扱う。 */
  readonly DISCORD_OTP_WEBHOOK_URL?: string;
  /**
   * 投稿先スレッドの ID。ID 自体は秘密ではないが、プレビューでしか使わない値なので、
   * `vars`（＝ wrangler.jsonc の 3 か所すべてに書く必要がある）ではなく secret で渡す。
   */
  readonly DISCORD_OTP_THREAD_ID?: string;
};

/** メールを送らずコンソールに出力する実装へ切り替える。理由をログに残す。 */
const fallbackToConsole = (reason: string): MailSender => {
  console.warn(`${reason}のため、メールを送信せずコンソールに出力します。`);
  return createConsoleMailSender();
};

/** SMTP（Oracle Email Delivery）で送る。認証情報が無ければコンソール出力に落とす。 */
const createSmtpMailSenderOrFallback = (): MailSender => {
  const { SMTP_USER: username, SMTP_PASSWORD: password } = env as Env & MailSecrets;

  if (!username || !password) {
    return fallbackToConsole("SMTP_USER / SMTP_PASSWORD が未設定");
  }

  return createSmtpMailSender({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    username,
    password,
  });
};

/** Discord のスレッドへ投稿する。設定が足りなければコンソール出力に落とす。 */
const createDiscordMailSenderOrFallback = (): MailSender => {
  const { DISCORD_OTP_WEBHOOK_URL: webhookUrl, DISCORD_OTP_THREAD_ID: threadId } = env as Env &
    MailSecrets;

  if (!webhookUrl || !threadId) {
    return fallbackToConsole("DISCORD_OTP_WEBHOOK_URL / DISCORD_OTP_THREAD_ID が未設定");
  }

  if (!URL.canParse(webhookUrl)) {
    return fallbackToConsole("DISCORD_OTP_WEBHOOK_URL が URL として読めない");
  }

  return createDiscordMailSender({ webhookUrl, threadId });
};

/**
 * 実行環境に応じた MailSender を組み立てる。
 *
 * | 環境       | 送信先                                             |
 * | ---------- | -------------------------------------------------- |
 * | ローカル   | ターミナル（SMTP の認証情報を入れれば実際に送る）  |
 * | プレビュー | Discord の特定のスレッド                           |
 * | 本番       | SMTP（Oracle Email Delivery）                      |
 *
 * プレビューで実メールを送らないのは、認証コードを受け取るために実在の
 * メールアドレスを用意しなくて済むようにするため。
 * どの環境でも、必要な設定が無ければコンソール出力にフォールバックするので、
 * 認証情報が無くてもログインの流れを最後まで試せる。
 *
 * Workers ではバインディングがリクエスト単位で解決されるため、
 * モジュール読み込み時ではなく呼び出しごとに生成すること。
 */
export const createMailSender = (): MailSender => {
  /*
   * Discord を選ぶ経路をプレビューだけに閉じておく。
   * Webhook URL を誤って本番に設定しても、ここを通らないので OTP は流出しない。
   *
   * `env.APP_ENV` の型は wrangler.jsonc の 3 か所に書いた値の union になる。
   * 値を足したり変えたりしたら `pnpm run cf-typegen` で型を更新すること。
   */
  if (env.APP_ENV === "preview") return createDiscordMailSenderOrFallback();

  return createSmtpMailSenderOrFallback();
};

/** 環境変数から差出人を解決する */
export const getMailFrom = (): { address: string; name: string } => ({
  address: env.MAIL_FROM_ADDRESS,
  name: env.MAIL_FROM_NAME,
});
