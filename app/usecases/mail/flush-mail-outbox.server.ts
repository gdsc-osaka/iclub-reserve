import { createMailMessage } from "~/domain/mail/mail-message";
import type { MailOutbox } from "~/domain/mail/mail-outbox";
import { isRetryable, MailSendErrorCode, type MailSender } from "~/domain/mail/mail-sender";

export interface FlushMailOutboxDeps {
  readonly mailOutbox: MailOutbox;
  readonly mailSender: MailSender;
  readonly from: { readonly address: string; readonly name?: string };
}

/** 1 回の実行で送る上限（ADR-002 / 仕様 4） */
export const FLUSH_BATCH_SIZE = 20;

/** 何回失敗したら諦めて dead にするか */
export const MAX_ATTEMPTS = 5;

/**
 * 次に送ってよい時刻までの待ち時間（ミリ秒）。
 * attemptCount はその取り出しを含む回数のため 1 から始まる。
 * 30 秒 → 1 分 → 2 分 → 4 分 → 8 分 と倍々になり、上限は 1 時間 (3,600,000 ms)。
 */
export const nextAttemptDelayMs = (attemptCount: number): number =>
  Math.min(30_000 * 2 ** (attemptCount - 1), 3_600_000);

export interface FlushMailOutboxResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly dead: number;
}

/**
 * 送信待ちのメールを outbox から取り出して送信するユースケース。
 *
 * 1 通ごとのエラーはログに残しつつ握りつぶし、残りのメールの送信を継続する。
 * （1 通の SMTP 失敗で全体の cron を止めないため）
 */
export const flushMailOutboxUseCase = async (
  deps: FlushMailOutboxDeps,
  options?: { readonly limit?: number; readonly now?: Date },
): Promise<FlushMailOutboxResult> => {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? FLUSH_BATCH_SIZE;

  const claimResult = await deps.mailOutbox.claimDue({ limit, now });
  if (claimResult.isErr()) {
    console.error("Failed to claim due mail outbox entries:", claimResult.error);
    return { claimed: 0, sent: 0, retried: 0, dead: 0 };
  }

  const entries = claimResult.value;
  let sent = 0;
  let retried = 0;
  let dead = 0;

  for (const entry of entries) {
    try {
      // 1. 本文とヘッダを組み立てる。Message-ID は再送を同一視できるよう outbox ID から固定生成する
      const messageResult = createMailMessage({
        from: deps.from,
        to: entry.to,
        subject: entry.subject,
        text: entry.text,
        html: entry.html,
        headers: {
          "Message-ID": `<${entry.id}@gdgoc-osaka.jp>`,
        },
      });

      // メールアドレス不正などプログラム・入力の誤りは再試行しても直らないため dead にする
      if (messageResult.isErr()) {
        console.warn(`Invalid mail message for outbox entry ${entry.id}:`, messageResult.error);
        await deps.mailOutbox.markDead({
          id: entry.id,
          error: {
            code: MailSendErrorCode.SendFailed,
            message: "メールの組み立てに失敗しました。",
            cause: messageResult.error,
          },
        });
        dead++;
        continue;
      }

      // 2. 送信を実行
      const sendResult = await deps.mailSender.send(messageResult.value);

      if (sendResult.isOk()) {
        await deps.mailOutbox.markSent(entry.id);
        sent++;
      } else {
        const error = sendResult.error;

        // 3. 一過性の失敗かつ試行回数が上限未満であれば次回へ先送り（backoff）
        if (isRetryable(error) && entry.attemptCount < MAX_ATTEMPTS) {
          const nextAttemptAt = new Date(now.getTime() + nextAttemptDelayMs(entry.attemptCount));
          await deps.mailOutbox.markRetryable({
            id: entry.id,
            nextAttemptAt,
            error,
          });
          retried++;
        } else {
          // 4. 恒久的な失敗（5xx / 254 / 認証不正）または最大試行回数超過
          await deps.mailOutbox.markDead({
            id: entry.id,
            error,
          });
          dead++;
        }
      }
    } catch (unexpectedError) {
      console.error(`Unexpected error processing outbox entry ${entry.id}:`, unexpectedError);
      dead++;
    }
  }

  return { claimed: entries.length, sent, retried, dead };
};
