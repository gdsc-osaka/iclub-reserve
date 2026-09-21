import { invitationAcceptPath } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { MembershipRole, membershipRoleLabel } from "~/domain/membership";
import { formatDateTime } from "~/lib/date";

/**
 * 招待通知メールの本文・属性組み立て。
 *
 * 【承諾リンクについて】
 * 招待メールに記載される承諾画面（SCR-016 / UC-022）はまだ実装されていないため、
 * 現時点でリンクを開くと 404 になる（次の PR で実装予定）。
 */

export interface InvitationMailArgs {
  readonly invitationId: string;
  readonly groupName: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly expiresAt: Date;
  /** このアプリの絶対 URL の土台（例: "https://example.com"）。承諾リンクの組み立てに使う */
  readonly appBaseUrl: string;
}

/**
 * 招待通知メール（EVT-014）の MailDraft を組み立てる純粋関数。
 *
 * - idempotencyKey は `invitation:created:${invitationId}:${email}` の形式とし、
 *   重複送信を防ぐために時刻や乱数を混ぜない。
 * - 承諾リンクの URL パスは `invitationAcceptPath` を通して生成する。
 * - 役割の表示名には `membershipRoleLabel` を使用する。
 */
export const createInvitationMailDraft = (args: InvitationMailArgs): MailDraft => {
  const acceptUrl = `${args.appBaseUrl}${invitationAcceptPath(args.invitationId)}`;
  const roleLabel = membershipRoleLabel[args.role];
  const formattedExpiresAt = formatDateTime(args.expiresAt);

  const lines = [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    `「${args.groupName}」への招待が届いています。`,
    "",
    `役割: ${roleLabel}`,
    `有効期限: ${formattedExpiresAt}`,
    "",
    "下のリンクを開いて、招待を承諾してください。",
    acceptUrl,
    "",
    "※ 有効期限を過ぎるとこのリンクは使えなくなります。",
    "※ 心当たりが無い場合は、このメールを破棄してください。",
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ];

  return {
    idempotencyKey: `invitation:created:${args.invitationId}:${args.email}`,
    to: { address: args.email },
    subject: `【i-Club予約システム】「${args.groupName}」への招待が届いています`,
    text: lines.join("\n"),
  };
};
