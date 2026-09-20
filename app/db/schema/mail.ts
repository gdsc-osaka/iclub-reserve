import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { MailOutboxStatus } from "~/domain/mail/mail-outbox";

export const mailOutboxTable = sqliteTable(
  "mail_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),

    /** 同じメールを二度積まないための鍵。詳細は MailDraft の JSDoc を参照 */
    idempotencyKey: text("idempotency_key").notNull().unique(),

    toAddress: text("to_address").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),

    status: text("status")
      .$type<MailOutboxStatus>()
      .notNull()
      .$default(() => MailOutboxStatus.Pending),

    /** 何回送信を試みたか。backoff の指数と、諦める判断に使う */
    attemptCount: integer("attempt_count").notNull().default(0),

    /** 次に送ってよい時刻。積んだ直後は「今すぐ」 */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** 直近の失敗。調査用にそのまま残す */
    lastError: text("last_error"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // cron が毎分投げるクエリの WHERE 句そのもの。行が増えても全表走査にしない
  (table) => [index("mail_outbox_due_idx").on(table.status, table.nextAttemptAt)],
);
