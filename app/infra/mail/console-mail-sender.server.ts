import { okAsync } from "neverthrow";
import type { MailSender } from "~/domain/mail/mail-sender";

/**
 * メールを送信せず、内容をコンソールに出力するだけの MailSender。
 *
 * SMTP の認証情報がなくても `pnpm run dev` で認証フローを最後まで試せるようにするための実装。
 * OTP がそのままターミナルに出るので、本番では絶対に使わないこと。
 */
export const createConsoleMailSender = (): MailSender => ({
  send(message) {
    console.info(
      [
        "───── メール送信（コンソール出力） ─────",
        `From   : ${message.from.name ?? ""} <${message.from.address.value}>`,
        `To     : ${message.to.name ?? ""} <${message.to.address.value}>`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "──────────────────────────────────────",
      ].join("\n"),
    );

    return okAsync(undefined);
  },
});
