/**
 * メール送信モジュール。
 * RESEND_API_KEY が設定されている場合は実際に送信、
 * そうでない場合はデモ用としてメール内容を返す（画面表示用）。
 */

export interface EmailPayload {
  to: string | string[];
  subject: string;
  body: string;
}

export interface EmailResult {
  /** 実際に送信された場合 true */
  sent: boolean;
  /** デモ用: 画面表示するメール内容（sent=false の場合のみ） */
  preview?: EmailPreview[];
}

export interface EmailPreview {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(
  resendApiKey: string | undefined,
  payload: EmailPayload,
  fromAddress = "iclub-reserve <noreply@example.com>",
): Promise<EmailResult> {
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  if (resendApiKey) {
    // 本番: Resend で実際に送信
    for (const to of recipients) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to,
          subject: payload.subject,
          html: payload.body,
        }),
      });
    }
    return { sent: true };
  }

  // デモ: 画面表示用データを返す
  const previews: EmailPreview[] = recipients.map((to) => ({
    to,
    subject: payload.subject,
    body: payload.body,
  }));
  return { sent: false, preview: previews };
}

/** 複数のメール送信結果を統合して EmailPreview[] を返す */
export function collectPreviews(results: EmailResult[]): EmailPreview[] {
  return results.flatMap((r) => r.preview ?? []);
}
