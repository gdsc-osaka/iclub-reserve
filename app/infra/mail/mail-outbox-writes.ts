import { createId } from "@paralleldrive/cuid2";
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { mailOutboxTable } from "~/db/schema";
import { MailOutboxStatus, type MailDraft } from "~/domain/mail/mail-outbox";

import type { Database } from "../db";

/**
 * outbox に積む 1 行ぶんの値。
 *
 * 既定値のある列も省略できない `$inferSelect` を使っているのは、
 * `mail_outbox` に列を足したときに `toMailOutboxValues` が
 * **コンパイルエラーになる**ようにするため。
 */
type MailOutboxValues = typeof mailOutboxTable.$inferSelect;

const mailOutboxColumns = getTableColumns(mailOutboxTable);

/**
 * `MailDraft` を `mail_outbox` の 1 行に写す。
 *
 * どの項目がどの列に入るかを決めているのは**ここだけ**。
 * 業務データ側の Repository（予約など）はこの対応を知らない。
 */
const toMailOutboxValues = (id: string, mail: MailDraft, now: Date): MailOutboxValues => ({
  id,
  idempotencyKey: mail.idempotencyKey,
  toAddress: mail.to.address,
  toName: mail.to.name ?? null,
  subject: mail.subject,
  bodyText: mail.text,
  bodyHtml: mail.html ?? null,
  status: MailOutboxStatus.Pending,
  attemptCount: 0,
  nextAttemptAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
});

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 *
 * 値は `sql.param` に列を添えて渡す。Drizzle の列マッパーを通るので、
 * 日時（timestamp_ms）の変換をここで手計算しなくて済む。
 * 別名も列の定義から取るため、snake_case を書き写して綴りを間違える余地が無い。
 */
const param = <K extends keyof MailOutboxValues>(values: MailOutboxValues, key: K) =>
  sql<MailOutboxValues[K]>`${sql.param(values[key], mailOutboxColumns[key])}`.as(
    mailOutboxColumns[key].name,
  );

/**
 * `INSERT ... SELECT` の SELECT 側に並べる列。
 *
 * `INSERT ... SELECT` は列が**位置で**対応するため、並びは `mail_outbox` の定義順に保つこと。
 * 既定値のある列も省略しない（省略すると位置がずれる）。
 */
const toMailOutboxProjection = (values: MailOutboxValues) => ({
  id: param(values, "id"),
  idempotencyKey: param(values, "idempotencyKey"),
  toAddress: param(values, "toAddress"),
  toName: param(values, "toName"),
  subject: param(values, "subject"),
  bodyText: param(values, "bodyText"),
  bodyHtml: param(values, "bodyHtml"),
  status: param(values, "status"),
  attemptCount: param(values, "attemptCount"),
  nextAttemptAt: param(values, "nextAttemptAt"),
  lastError: param(values, "lastError"),
  createdAt: param(values, "createdAt"),
  updatedAt: param(values, "updatedAt"),
});

/**
 * 業務データの書き込みと同じ `db.batch()` に渡す、outbox への INSERT 文。
 *
 * 呼び出し側は `db.batch([業務の文, ...statements])` と書き、
 * 戻ってきた `ids` を `MailOutboxNotifier` に渡す（ADR-002 決定 1）。
 */
export interface MailOutboxWrites {
  /** この操作で積むメールの行 ID。Queues への即時配送の依頼に使う。`mails` と同じ並び */
  readonly ids: readonly string[];
  /** `db.batch()` に渡す INSERT 文。`mails` と同じ並び */
  readonly statements: readonly BatchItem<"sqlite">[];
}

/**
 * 無条件に積む INSERT を組む。
 *
 * 同じ batch に入れる業務データの書き込みが**条件付きでない**ときに使う。
 * 予約の新規作成のように、その書き込みが失敗すれば batch ごと巻き戻る場合が該当する。
 *
 * `ON CONFLICT (idempotency_key) DO NOTHING` を付けるのは、鍵が衝突したときに
 * batch 全体がロールバックされて**業務データの書き込みまで無かったことになる**のを防ぐため。
 */
export const mailOutboxInserts = (db: Database, mails: readonly MailDraft[]): MailOutboxWrites => {
  const now = new Date();
  const ids: string[] = [];

  const statements = mails.map((mail) => {
    const id = createId();
    ids.push(id);

    return db
      .insert(mailOutboxTable)
      .values(toMailOutboxValues(id, mail, now))
      .onConflictDoNothing({ target: mailOutboxTable.idempotencyKey });
  });

  return { ids, statements };
};

/**
 * 業務データを伴わずに、メールだけを単独で積む。積んだ行の ID を返す。
 *
 * ADR-002 は「業務データと同じ batch で積む」ことを原則にしている。これはその例外で、
 * 業務データの書き込みを認証基盤（Better Auth）が行うため、同じ batch に入れられない場合にだけ使う。
 * いま使っているのは、メールアドレスの切り替えの後に積む変更の通知（EVT-016）だけ。
 * 切り替えの後に積むので、ここで失敗すると通知は届かない（そのリスクは EVT-016 で受け入れている）。
 */
export const insertMailsAlone = async (
  db: Database,
  mails: readonly MailDraft[],
): Promise<readonly string[]> => {
  const { ids, statements } = mailOutboxInserts(db, mails);
  const [first, ...rest] = statements;
  if (first === undefined) return [];

  await db.batch([first, ...rest]);
  return ids;
};

/** 条件付きで積むときに、「業務データが実際に書かれたか」を確かめる条件 */
export interface MailOutboxGuard {
  /** 確かめる先の表（業務データを書いた表） */
  readonly from: SQLiteTable;
  /** 書き込み**後**の状態と突き合わせる条件。合う行が 1 件も無ければメールは積まれない */
  readonly where: SQL | undefined;
}

/**
 * 業務データが実際に書かれたときにだけ積む INSERT を組む。
 *
 * `db.batch()` は中の文を**無条件に全部実行する**ので、条件付き UPDATE と素直に並べると、
 * 更新が 0 件（競合で失敗）でも通知が積まれてしまう。
 * そこで `INSERT ... SELECT ... FROM <業務の表> WHERE <書き込み後の状態>` の形にし、
 * 同じ batch の中で直前の書き込みの結果を読ませる（ADR-002 決定 3）。
 *
 * SELECT は SQL 文字列ではなく Drizzle のクエリビルダで組む。列を `mailOutboxTable` の
 * キーで書けるので綴りの誤りは型エラーになり、並びが表の定義とずれていれば
 * Drizzle が実行前に例外で止める（生の SQL 文字列では誰も検査しない）。
 */
export const guardedMailOutboxInserts = (
  db: Database,
  mails: readonly MailDraft[],
  guard: MailOutboxGuard,
): MailOutboxWrites => {
  const now = new Date();
  const ids: string[] = [];

  const statements = mails.map((mail) => {
    const id = createId();
    ids.push(id);

    const values = toMailOutboxValues(id, mail, now);

    return db
      .insert(mailOutboxTable)
      .select(db.select(toMailOutboxProjection(values)).from(guard.from).where(guard.where))
      .onConflictDoNothing({ target: mailOutboxTable.idempotencyKey });
  });

  return { ids, statements };
};
