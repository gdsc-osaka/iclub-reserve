import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";
import { mailOutboxTable } from "~/db/schema";
import {
  MailOutboxErrorCode,
  MailOutboxStatus,
  type MailOutbox,
  type MailOutboxEntry,
  type MailOutboxError,
} from "~/domain/mail/mail-outbox";
import type { MailSendError } from "~/domain/mail/mail-sender";
import type { Database } from "../db";

/** 送信中のまま放置されたとみなすまでの時間。Worker が途中で落ちた行を救う（ADR-002 決定 4） */
export const STUCK_AFTER_MS = 5 * 60 * 1000;

const toMailOutboxError = (cause: unknown): MailOutboxError => ({
  code: MailOutboxErrorCode.DatabaseError,
  message: "outbox 操作に失敗しました。",
  cause,
});

const formatMailSendError = (error: MailSendError): string => {
  const cause = error.cause ? String(error.cause) : "";
  return cause ? `${error.code}: ${cause}` : error.code;
};

const toMailOutboxEntry = (row: typeof mailOutboxTable.$inferSelect): MailOutboxEntry => ({
  id: row.id,
  idempotencyKey: row.idempotencyKey,
  to: {
    address: row.toAddress,
    ...(row.toName ? { name: row.toName } : {}),
  },
  subject: row.subject,
  text: row.bodyText,
  ...(row.bodyHtml ? { html: row.bodyHtml } : {}),
  attemptCount: row.attemptCount,
});

/**
 * 送信可能な状態（pending かつ時刻到来、または sending かつ放置）を判定する述語（ADR-002 決定 2.3）。
 *
 * 取り出しの規則を claimDue と claimByIds で共有することで、
 * 判定条件の食い違いを防ぎ、バックオフ待ちの行がキュー経由で予定より早く再送されるのを防ぐ。
 */
const buildDuePredicate = (now: Date) =>
  or(
    // 送信時刻が到来したもの
    and(
      eq(mailOutboxTable.status, MailOutboxStatus.Pending),
      lte(mailOutboxTable.nextAttemptAt, now),
    ),
    // 送信中のまま放置されたもの（Worker の異常終了などで回収が必要な行）
    and(
      eq(mailOutboxTable.status, MailOutboxStatus.Sending),
      lte(mailOutboxTable.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
    ),
  );

/**
 * Cloudflare D1 (Drizzle) を使った MailOutbox の実装。
 *
 * 送信待ちの取り出しは 1 文の UPDATE ... RETURNING で不可分に行い、
 * cron 同士や将来の queue consumer との二重取り出しを防ぐ。
 */
export const createD1MailOutbox = (db: Database): MailOutbox => ({
  claimDue: ({ limit, now }) =>
    ResultAsync.fromPromise(
      db
        .update(mailOutboxTable)
        .set({
          status: MailOutboxStatus.Sending,
          attemptCount: sql`${mailOutboxTable.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(
          inArray(
            mailOutboxTable.id,
            db
              .select({ id: mailOutboxTable.id })
              .from(mailOutboxTable)
              .where(buildDuePredicate(now))
              .orderBy(asc(mailOutboxTable.nextAttemptAt))
              .limit(limit),
          ),
        )
        .returning(),
      toMailOutboxError,
    ).map((rows) => rows.map(toMailOutboxEntry)),

  claimByIds: ({ ids, now }) => {
    // Drizzle の inArray は空配列を受け付けないため、即座に空配列を返す
    if (ids.length === 0) {
      return okAsync([]);
    }

    return ResultAsync.fromPromise(
      db
        .update(mailOutboxTable)
        .set({
          status: MailOutboxStatus.Sending,
          attemptCount: sql`${mailOutboxTable.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(and(inArray(mailOutboxTable.id, [...ids]), buildDuePredicate(now)))
        .returning(),
      toMailOutboxError,
    ).map((rows) => rows.map(toMailOutboxEntry));
  },

  markSent: (id) =>
    ResultAsync.fromPromise(
      db
        .update(mailOutboxTable)
        .set({
          status: MailOutboxStatus.Sent,
          updatedAt: new Date(),
        })
        .where(eq(mailOutboxTable.id, id)),
      toMailOutboxError,
    ).map(() => undefined),

  markRetryable: (args) =>
    ResultAsync.fromPromise(
      db
        .update(mailOutboxTable)
        .set({
          status: MailOutboxStatus.Pending,
          nextAttemptAt: args.nextAttemptAt,
          lastError: formatMailSendError(args.error),
          updatedAt: new Date(),
        })
        .where(eq(mailOutboxTable.id, args.id)),
      toMailOutboxError,
    ).map(() => undefined),

  markDead: (args) =>
    ResultAsync.fromPromise(
      db
        .update(mailOutboxTable)
        .set({
          status: MailOutboxStatus.Dead,
          lastError: formatMailSendError(args.error),
          updatedAt: new Date(),
        })
        .where(eq(mailOutboxTable.id, args.id)),
      toMailOutboxError,
    ).map(() => undefined),
});
