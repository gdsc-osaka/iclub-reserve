import { errAsync, okAsync } from "neverthrow";
import type { MailMessage } from "~/domain/mail/mail-message";
import type { MailSender, MailSendError } from "~/domain/mail/mail-sender";

export type FakeMailSender = MailSender & {
  /** 送信された（ことになっている）メールを送信順に保持する */
  readonly sent: MailMessage[];
};

/**
 * テスト用の MailSender。送信せずに内容を配列へ貯める。
 *
 * `failWith` を渡すと常に失敗を返すので、異常系の検証にも使える。
 */
export const createFakeMailSender = (failWith?: MailSendError): FakeMailSender => {
  const sent: MailMessage[] = [];

  return {
    sent,
    send(message) {
      if (failWith) return errAsync(failWith);

      sent.push(message);
      return okAsync(undefined);
    },
  };
};
