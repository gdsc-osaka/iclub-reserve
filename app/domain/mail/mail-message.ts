import {
  createEmailAddress,
  type EmailAddress,
  type InvalidEmailAddressError,
} from "./email-address";
import { err, ok, type Result } from "neverthrow";

/** メールの差出人・宛先。表示名は任意 */
export type MailAddressee = {
  readonly address: EmailAddress;
  readonly name?: string;
};

/** メール本文の組み立てに失敗したことを表すエラー */
export type InvalidMailMessageError =
  | InvalidEmailAddressError
  | { readonly type: "empty_subject" }
  | { readonly type: "empty_body" };

/**
 * 送信する 1 通のメールを表す値オブジェクト。
 *
 * `createMailMessage` を通してのみ生成できるため、
 * この型の値を受け取った時点で「件名と本文がある」ことが保証される。
 */
export type MailMessage = {
  readonly from: MailAddressee;
  readonly to: MailAddressee;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
};

export type CreateMailMessageInput = {
  readonly from: { readonly address: string; readonly name?: string };
  readonly to: { readonly address: string; readonly name?: string };
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
};

/** 生の文字列を検証して MailMessage を生成する */
export const createMailMessage = (
  input: CreateMailMessageInput,
): Result<MailMessage, InvalidMailMessageError> => {
  const from = createEmailAddress(input.from.address);
  if (from.isErr()) return err(from.error);

  const to = createEmailAddress(input.to.address);
  if (to.isErr()) return err(to.error);

  const subject = input.subject.trim();
  if (subject.length === 0) return err({ type: "empty_subject" });

  const text = input.text.trim();
  if (text.length === 0) return err({ type: "empty_body" });

  return ok({
    from: { address: from.value, ...(input.from.name ? { name: input.from.name } : {}) },
    to: { address: to.value, ...(input.to.name ? { name: input.to.name } : {}) },
    subject,
    text,
    ...(input.html ? { html: input.html } : {}),
  });
};
