import type { MailDraft } from "~/domain/mail/mail-outbox";
import { staffInvitationAcceptPath } from "~/domain/staff";
import { formatDateTime } from "~/lib/date";

export interface StaffInvitationMailArgs {
  readonly invitationId: string;
  readonly email: string;
  readonly expiresAt: Date;
  /** このアプリの絶対 URL の土台（例: "https://example.com"）。承諾リンクの組み立てに使う */
  readonly appBaseUrl: string;
}

/**
 * 事務局招待通知メール（EVT-015）の MailDraft を組み立てる純粋関数。
 *
 * - idempotencyKey は `staff-invitation:created:${invitationId}:${email}` の形式とし、
 *   重複送信を防ぐために時刻や乱数を混ぜない。
 * - 承諾リンクの URL パスは `staffInvitationAcceptPath` を通して生成する。
 */
export const createStaffInvitationMailDraft = (args: StaffInvitationMailArgs): MailDraft => {
  const acceptUrl = `${args.appBaseUrl}${staffInvitationAcceptPath(args.invitationId)}`;
  const formattedExpiresAt = formatDateTime(args.expiresAt);

  const lines = [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    "事務局への招待が届いています。",
    "",
    "事務局になると、所属に関わらず全団体・全予約を操作できるようになります。",
    `有効期限: ${formattedExpiresAt}`,
    "",
    "下のリンクを開いて、招待を承諾してください。",
    acceptUrl,
    "",
    "※ 招待を承諾するには、この宛先のメールアドレスでログインして開く必要があります。",
    "※ 有効期限を過ぎるとこのリンクは使えなくなります。",
    "※ 心当たりが無い場合は、このメールを破棄してください。",
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ];

  return {
    idempotencyKey: `staff-invitation:created:${args.invitationId}:${args.email}`,
    to: { address: args.email },
    subject: "【i-Club予約システム】事務局への招待が届いています",
    text: lines.join("\n"),
  };
};
