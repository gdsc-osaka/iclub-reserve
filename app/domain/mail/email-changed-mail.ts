import type { MailDraft } from "~/domain/mail/mail-outbox";
import { formatDateTime } from "~/lib/date";

export interface EmailChangedMailArgs {
  readonly userId: string;
  readonly userName: string;
  readonly previousEmail: string;
  readonly newEmail: string;
  readonly changedAt: Date;
  readonly staffContactEmail: string;
}

/**
 * メールアドレス変更通知メール（EVT-016）の MailDraft を組み立てる純粋関数。
 *
 * 【idempotencyKey について】
 * `mail-outbox.ts` は「idempotencyKey に時刻を混ぜない」と定めているが、ここは例外とする。
 * 1. メールアドレスの切り替えは認証コードを 1 回消費して 1 度しか成功しないため、同じ操作をやり直しても二重には積まれない。
 * 2. 逆に時刻を入れないと、A → B → A → B と複数回メールアドレスを変更した際、以前と同じアドレスへの変更通知が
 *    鍵の衝突によって黙って捨てられてしまうのを防ぐためである。
 */
export const createEmailChangedMailDraft = (args: EmailChangedMailArgs): MailDraft => {
  const formattedChangedAt = formatDateTime(args.changedAt);

  const lines = [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    "メールアドレスの変更が完了しました。",
    "",
    `変更後のメールアドレス: ${args.newEmail}`,
    `変更日時: ${formattedChangedAt}`,
    "",
    "※ この変更にお心当たりがない場合は、第三者によってアカウントが不正に操作された可能性があります。至急、下記の事務局窓口までご連絡ください。",
    `事務局窓口: ${args.staffContactEmail}`,
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ];

  return {
    idempotencyKey: `user:email-changed:${args.userId}:${args.changedAt.getTime()}`,
    // 宛名が空のまま積むと、宛先欄に空の名前が出てしまうので付けない
    to:
      args.userName === ""
        ? { address: args.previousEmail }
        : { address: args.previousEmail, name: args.userName },
    subject: "【i-Club予約システム】メールアドレス変更完了のお知らせ",
    text: lines.join("\n"),
  };
};
