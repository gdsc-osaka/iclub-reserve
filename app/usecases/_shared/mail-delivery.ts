import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";

/**
 * outbox へ積んだメールの即時配送を依頼する（ADR-002 決定 1）。
 *
 * 必ず、書き込みと outbox への追加が不可分に成功したあとに呼ぶこと。
 * 先に呼ぶと、結局積まれなかったメールの ID を配送側へ渡してしまう。
 *
 * 依頼の結果は受け取らない（notifyEnqueued は void）。キューへ届かなくても
 * outbox の行は残り、遅くとも 1 分後に cron が拾うので、業務処理としては成功のまま返す。
 *
 * ポートの取り決めでは notifyEnqueued は例外を投げないが、ここで捕まえておく。
 * 呼ぶ時点で書き込みはすでに確定しているので、通知の都合で画面にエラーを出すと、
 * 利用者は「失敗した」と思って同じ操作をもう一度実行してしまう。
 * 予約や招待が二重に作られたり、やり直した操作が今度は競合で弾かれたりする。
 */
export const requestImmediateDelivery = (
  notifier: MailOutboxNotifier,
  outboxIds: readonly string[],
): void => {
  try {
    notifier.notifyEnqueued(outboxIds);
  } catch (error) {
    console.error("Failed to request immediate mail delivery:", { outboxIds }, error);
  }
};
