import { createMailMessage, type InvalidMailMessageError } from "~/domain/mail/mail-message";
import type { MailSender, MailSendError } from "~/domain/mail/mail-sender";
import type { ResultAsync } from "neverthrow";

/** メール送信で起こりうる失敗をまとめた型 */
export type SendEmailError = InvalidMailMessageError | MailSendError;

export type SendEmailInput = {
  readonly to: string;
  readonly toName?: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
};

export type SendEmailUseCase = (input: SendEmailInput) => ResultAsync<void, SendEmailError>;

export type SendEmailDeps = {
  /** メール送信の実装（infra 層から注入する） */
  readonly mailSender: MailSender;
  /** 差出人。環境変数から解決した値を渡す */
  readonly from: { readonly address: string; readonly name?: string };
};

/**
 * メールを 1 通送信する汎用ユースケース。
 *
 * 「どう送るか」は MailSender に任せ、ここでは入力の検証と組み立てだけを行う。
 * OTP 通知や予約の承認通知など、個別のメールはこのユースケースに委譲する。
 *
 * 戻り値は ResultAsync なので、呼び出し側は `await` して `isOk()` / `isErr()` で
 * 分岐するか、`match` で成功時・失敗時の処理をまとめて書ける。
 */
export const createSendEmailUseCase =
  (deps: SendEmailDeps): SendEmailUseCase =>
  (input) =>
    // 同期の Result から非同期の ResultAsync へ繋ぐには asyncAndThen を使う。
    // 組み立てに失敗した場合は送信されず、そのエラーがそのまま伝播する。
    createMailMessage({
      from: deps.from,
      to: { address: input.to, ...(input.toName ? { name: input.toName } : {}) },
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }).asyncAndThen((message) => deps.mailSender.send(message));
