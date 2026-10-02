import { eq } from "drizzle-orm";
import { mailOutboxTable } from "~/db/schema";
import type { E2eDb } from "./db.js";

/** 積まれた通知メールのうち、テストで確かめる項目 */
export interface QueuedMail {
  readonly subject: string;
  readonly bodyText: string;
}

/**
 * ある宛先に向けて積まれた通知メールを読む。
 *
 * 予約や招待の通知は、操作と同時に送信待ちの表（`mail_outbox`、ADR-002）へ積まれ、
 * 後から Queue と Cron が送る。E2E では「積まれたか」までを確かめ、
 * 送信済みかどうか（`status`）は見ない。E2E のアプリでも Queue が動くので、
 * すぐに `sent` に変わることがある（送り先はターミナルへの出力）。送る仕組みは単体テストで確かめている。
 *
 * 予約の通知の本文には予約 ID が入るので、どの予約の通知かは ID で見分ける。
 */
export async function findQueuedMails(db: E2eDb, to: string): Promise<QueuedMail[]> {
  return db
    .select({ subject: mailOutboxTable.subject, bodyText: mailOutboxTable.bodyText })
    .from(mailOutboxTable)
    .where(eq(mailOutboxTable.toAddress, to));
}
