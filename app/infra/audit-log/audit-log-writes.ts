import { createId } from "@paralleldrive/cuid2";
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { auditLogTable } from "~/db/schema";
import { auditLogActionTargetType, type AuditLogDraft } from "~/domain/audit-log";

import type { Database } from "../db";

/**
 * audit_log に書く 1 行ぶんの値。
 *
 * 既定値のある列も省略できない `$inferSelect` を使っているのは、
 * `audit_log` に列を足したときに `toAuditLogValues` が
 * **コンパイルエラーになる**ようにするため。
 */
type AuditLogValues = typeof auditLogTable.$inferSelect;

const auditLogColumns = getTableColumns(auditLogTable);

/**
 * `AuditLogDraft` を `audit_log` の 1 行に写す。
 *
 * id はここで採番し、targetType は action から導く。
 */
const toAuditLogValues = (id: string, draft: AuditLogDraft): AuditLogValues => ({
  id,
  occurredAt: draft.occurredAt,
  actorId: draft.actorId,
  actedAsStaff: draft.actedAsStaff,
  action: draft.action,
  targetType: auditLogActionTargetType[draft.action],
  targetId: draft.targetId,
  groupId: draft.groupId,
  changes: draft.changes,
});

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 *
 * 値は `sql.param` に列を添えて渡す。Drizzle の列マッパーを通るので、
 * 日時（timestamp_ms）、boolean、JSON の変換をここで手計算しなくて済む。
 * 別名も列の定義から取るため、snake_case を書き写して綴りを間違える余地が無い。
 */
const param = <K extends keyof AuditLogValues>(values: AuditLogValues, key: K) =>
  sql<AuditLogValues[K]>`${sql.param(values[key], auditLogColumns[key])}`.as(
    auditLogColumns[key].name,
  );

/**
 * `INSERT ... SELECT` の SELECT 側に並べる列。
 *
 * `INSERT ... SELECT` は列が**位置で**対応するため、並びは `auditLogTable` の定義順に保つこと。
 * 既定値のある列も省略しない（省略すると位置がずれる）。
 */
const toAuditLogProjection = (values: AuditLogValues) => ({
  id: param(values, "id"),
  occurredAt: param(values, "occurredAt"),
  actorId: param(values, "actorId"),
  actedAsStaff: param(values, "actedAsStaff"),
  action: param(values, "action"),
  targetType: param(values, "targetType"),
  targetId: param(values, "targetId"),
  groupId: param(values, "groupId"),
  changes: param(values, "changes"),
});

/** 条件付きで書くときに、「業務データが実際に書かれるか」を確かめる条件 */
export interface AuditLogGuard {
  /** 確かめる先の表または式（業務データを書き換える対象） */
  readonly from: SQLiteTable | SQL;
  /** 書き込み**前**の状態と突き合わせる条件。合う行が無ければ記録は入らない */
  readonly where: SQL | undefined;
}

/**
 * 操作履歴への無条件の INSERT 文を組む。
 *
 * 業務データの書き込みが条件付きでない INSERT（予約の申請、団体の作成、招待の送信、
 * 施設の登録、事務局への招待など）の場合に使う。
 * 業務データと同じ batch の**後ろ**に置き、業務の INSERT が失敗すれば batch ごと巻き戻る。
 */
export const auditLogInsert = (db: Database, draft: AuditLogDraft): BatchItem<"sqlite"> => {
  const id = createId();
  return db.insert(auditLogTable).values(toAuditLogValues(id, draft));
};

/**
 * 業務データが実際に書かれるときにだけ記録する条件付き INSERT 文を組む。
 *
 * 【なぜ条件付きにするのか】
 * `db.batch()` は中の文を**無条件に全部実行する**。そのため、業務データの書き込みが
 * 条件付き（状態を確かめる UPDATE / DELETE や `INSERT ... SELECT ... WHERE`）の場合、
 * 競合などで更新が 0 件になっても記録だけが残ってしまう。
 * そこで `INSERT INTO audit_log SELECT <値> FROM <guard.from> WHERE <guard.where>` の形にし、
 * 条件に合う行が存在するときだけ 1 行が入るようにする。
 *
 * 【なぜ書き込みの「前」に置くのか】
 * 1. `audit_log` への INSERT は業務の表を変更しないため、後続の業務書き込みと同じ「書き込み前の状態」を条件に共有できる。
 * 2. 書き込み「後」の状態を条件にすると、削除（メンバーシップの削除）では行が消えてしまい、
 *    また `updated_at` 列が無い表（招待など）では「この batch で書いた行」と「以前からその状態だった行」を見分けられない。
 * 3. D1 の batch は 1 つのトランザクションで順に実行され、間に他の割り込みは入らないため、
 *    業務書き込みの直前に同じ条件で置くことで、業務データが書かれるときに限り確実に 1 行が入る。
 */
export const guardedAuditLogInsert = (
  db: Database,
  draft: AuditLogDraft,
  guard: AuditLogGuard,
): BatchItem<"sqlite"> => {
  const id = createId();
  const values = toAuditLogValues(id, draft);

  return db
    .insert(auditLogTable)
    .select(db.select(toAuditLogProjection(values)).from(guard.from).where(guard.where));
};
