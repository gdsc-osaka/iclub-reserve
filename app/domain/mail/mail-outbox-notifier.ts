/**
 * outbox に積んだメールの即時配送を依頼するポート（ADR-002 決定 1）。
 *
 * outbox に行が残っている限り通知は消えないため、この依頼はあくまで**近道**である。
 * 依頼が届かなくても遅くとも 1 分後には cron が拾うので、失敗を呼び出し元へ返さない。
 * 戻り値を持たせないのはそのためで、業務処理の成否をここで左右させない意図を型で示している。
 */
export interface MailOutboxNotifier {
  /**
   * 積んだメールの ID を配送側へ知らせる。
   *
   * @param outboxIds この操作で outbox に積んだメールの ID。空配列なら何もしない。
   */
  notifyEnqueued(outboxIds: readonly string[]): void;
}
