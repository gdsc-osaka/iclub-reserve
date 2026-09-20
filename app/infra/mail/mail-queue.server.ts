import { env, waitUntil } from "cloudflare:workers";

import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";

/** Queues に載せるメッセージ。行そのものではなく ID だけを運ぶ */
export type MailQueueMessage = { readonly outboxIds: readonly string[] };

/**
 * Cloudflare Queues で即時配送を依頼する MailOutboxNotifier の実装（ADR-002 決定 1 / 決定 2.2）。
 *
 * 失敗しても通知は消えない（遅くとも 1 分後に cron が拾う）。
 * そのためエラーは握りつぶし、業務処理の成功を妨げないようにする。
 */
export const createQueueMailOutboxNotifier = (): MailOutboxNotifier => ({
  notifyEnqueued: (outboxIds) => {
    // 送る対象が無ければ何もしない
    if (outboxIds.length === 0) {
      return;
    }

    // バインディングが無い環境でも通知が落ちないようにする（cron が回収する）
    if (!env.MAIL_QUEUE) {
      console.warn("MAIL_QUEUE binding is not configured. Falling back to cron delivery.");
      return;
    }

    /*
     * Workers では await せずに放置した Promise はレスポンス返却後に打ち切られるため、
     * waitUntil に渡してバックグラウンドで実行させる。
     * また、キューへの投入失敗で業務処理が失敗しないよう catch で握りつぶす。
     */
    waitUntil(
      env.MAIL_QUEUE.send({ outboxIds }).catch((error) => {
        console.error("Failed to enqueue mail IDs to MAIL_QUEUE:", error);
      }),
    );
  },
});
