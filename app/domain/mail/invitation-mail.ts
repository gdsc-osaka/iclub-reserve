import { invitationAcceptPath } from "~/domain/invitation";
import { toMailBodies } from "~/domain/mail/mail-bodies";
import type { MailContent } from "~/domain/mail/mail-content";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { MembershipRole, membershipRoleLabel } from "~/domain/membership";
import { formatDateTime } from "~/lib/date";

/**
 * 招待通知メールの本文・属性組み立て。
 *
 * 【承諾リンクについて】
 * 招待メールに記載される承諾画面（SCR-016 / UC-022）は `/invitations/:invitationId` に配置されている。
 * 承諾リンクの URL は、画面パスを一元管理する `invitationAcceptPath` を通して組み立てる。
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

  const content: MailContent = {
    lead: `「${args.groupName}」への招待が届いています。`,
    blocks: [
      {
        type: "details",
        rows: [
          { label: "役割", value: roleLabel },
          { label: "有効期限", value: formattedExpiresAt },
        ],
      },
      {
        type: "action",
        prompt: "下のリンクを開いて、招待を承諾してください。",
        label: "招待を承諾する",
        url: acceptUrl,
      },
      {
        type: "footnotes",
        items: [
          "有効期限を過ぎるとこのリンクは使えなくなります。",
          "心当たりが無い場合は、このメールを破棄してください。",
        ],
      },
    ],
  };

  const { text, html } = toMailBodies(content);

  return {
    idempotencyKey: `invitation:created:${args.invitationId}:${args.email}`,
    to: { address: args.email },
    subject: `【i-Club 予約システム】「${args.groupName}」への招待が届いています`,
    text,
    html,
  };
};
