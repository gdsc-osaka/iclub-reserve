import type { ResultAsync } from "neverthrow";
import type { BaseError } from "~/domain/error";
import type { MailSendError } from "./mail-sender";

/** outbox の行がとりうる状態 */
export const MailOutboxStatus = {
  /** 送信待ち。next_attempt_at を過ぎたら送ってよい */
  Pending: "pending",
  /** 取り出し済み。誰かが今まさに送っている */
  Sending: "sending",
  /** 送信済み。終端 */
  Sent: "sent",
  /** 諦めた。終端。再送するなら手動で pending に戻す */
  Dead: "dead",
} as const;
export type MailOutboxStatus = (typeof MailOutboxStatus)[keyof typeof MailOutboxStatus];

/**
 * これから送るメール 1 通。業務処理の中で組み立て、業務データと同じ batch で積む。
 *
 * 差出人 (from) は持たない。送信時に環境変数から解決するため、
 * 差出人を変えても積まれたままのメールに影響しない。
 */
export interface MailDraft {
  /**
   * 同じメールを二度積まないための鍵。
   * 「イベント種別 : 対象の ID : 宛先」から決まる文字列にすること。
   * 例: "reservation:approved:clx0123:cly4567"
   *
   * ここに時刻や乱数を混ぜてはいけない。混ぜた瞬間に UNIQUE が意味を失い、
   * 操作をやり直しただけで同じ通知が 2 通飛ぶ。
   */
  readonly idempotencyKey: string;
  readonly to: { readonly address: string; readonly name?: string };
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/** outbox から取り出した、送信権を握っているメール 1 通 */
export interface MailOutboxEntry extends MailDraft {
  readonly id: string;
  /** 何回目の送信か (この取り出しを含む) */
  readonly attemptCount: number;
}

export const MailOutboxErrorCode = {
  DatabaseError: "DATABASE_ERROR",
} as const;
export type MailOutboxErrorCode = (typeof MailOutboxErrorCode)[keyof typeof MailOutboxErrorCode];

export interface MailOutboxError extends BaseError {
  readonly code: MailOutboxErrorCode;
}

/**
 * Transactional Outbox の永続化・取り出しポート。
 *
 * 業務データの更新トランザクション（db.batch）と同時に書き込まれたメールを、
 * cron（Phase 1）および Queue（Phase 2）から安全に取り出して配送・状態更新するための窓口。
 */
export interface MailOutbox {
  /**
   * 送信待ちの行を取り出し、同時に status を 'sending' にする。
   *
   * UPDATE … RETURNING の 1 文で行うため、cron と queue consumer が同時に走っても
   * 同じ行を 2 回取り出すことはない。
   */
  claimDue(args: {
    readonly limit: number;
    readonly now: Date;
  }): ResultAsync<readonly MailOutboxEntry[], MailOutboxError>;

  /**
   * ID を指定して取り出す。Queues 経由の即時配送で使う。送信済み・再試行待ちの行は返らない。
   */
  claimByIds(args: {
    readonly ids: readonly string[];
    readonly now: Date;
  }): ResultAsync<readonly MailOutboxEntry[], MailOutboxError>;

  /** 送信成功。status を 'sent' にして完了とする */
  markSent(id: string): ResultAsync<void, MailOutboxError>;

  /**
   * 一過性の失敗。next_attempt_at を先送りして 'pending' に戻す。
   *
   * 次にいつ送るかは**呼ぶ側が決めて渡す**。backoff は再送の方針そのものなので
   * usecase の持ち物であり、infra に既定値を置くと同じ規則が 2 か所に増える。
   */
  markRetryable(args: {
    readonly id: string;
    readonly error: MailSendError;
    readonly nextAttemptAt: Date;
  }): ResultAsync<void, MailOutboxError>;

  /** 恒久的な失敗（または上限到達）。'dead' にして以後は自動再送しない */
  markDead(args: {
    readonly id: string;
    readonly error: MailSendError;
  }): ResultAsync<void, MailOutboxError>;
}
