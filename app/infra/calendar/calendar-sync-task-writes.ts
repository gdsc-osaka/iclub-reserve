import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { calendarSyncTaskTable } from "~/db/schema";
import { CalendarSyncStatus, type CalendarSyncTaskDraft } from "~/domain/calendar";

import type { Database } from "../db";

/**
 * calendar_sync_task に積む 1 行ぶんの値。
 *
 * 既定値のある列も省略できない `$inferSelect` を使っているのは、
 * テーブルに列を足したときに `toCalendarSyncTaskValues` をコンパイルエラーにして漏れを防ぐため。
 */
type CalendarSyncTaskValues = typeof calendarSyncTaskTable.$inferSelect;

const calendarSyncTaskColumns = getTableColumns(calendarSyncTaskTable);

/**
 * CalendarSyncTaskDraft を calendar_sync_task の 1 行に写す。
 *
 * id は null を入れて SQLite の自動採番に任せる（INTEGER PRIMARY KEY に null を入れると採番される）。
 * Drizzle の `insert().select()` は表の全列を並べることを求めるため、id も省略できない。
 */
const toCalendarSyncTaskValues = (
  draft: CalendarSyncTaskDraft,
  now: Date,
): CalendarSyncTaskValues => ({
  id: null as unknown as number,
  reservationId: draft.reservationId,
  previousFacilityId: draft.previousFacilityId,
  status: CalendarSyncStatus.Pending,
  attemptCount: 0,
  nextAttemptAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
});

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 */
const param = <K extends keyof CalendarSyncTaskValues>(values: CalendarSyncTaskValues, key: K) =>
  sql<CalendarSyncTaskValues[K]>`${sql.param(values[key], calendarSyncTaskColumns[key])}`.as(
    calendarSyncTaskColumns[key].name,
  );

/**
 * `INSERT ... SELECT` の SELECT 側に並べる列。
 *
 * `INSERT ... SELECT` は列が位置で対応するため、並びは calendar_sync_task の定義順に保つこと。
 * Drizzle のバリデーションにより、テーブル定義の全列（id 含む）が同じ順序で並んでいる必要がある。
 */
const toCalendarSyncTaskProjection = (values: CalendarSyncTaskValues) => ({
  id: param(values, "id"),
  reservationId: param(values, "reservationId"),
  previousFacilityId: param(values, "previousFacilityId"),
  status: param(values, "status"),
  attemptCount: param(values, "attemptCount"),
  nextAttemptAt: param(values, "nextAttemptAt"),
  lastError: param(values, "lastError"),
  createdAt: param(values, "createdAt"),
  updatedAt: param(values, "updatedAt"),
});

/** 条件付きで積むときに、「業務データが実際に書かれたか」を確かめる条件 */
export interface CalendarSyncTaskGuard {
  /** 確かめる先の表または式（業務データを書いた表） */
  readonly from: SQLiteTable | SQL;
  /** 書き込み後の状態と突き合わせる条件。合う行が無ければタスクは積まれない */
  readonly where: SQL | undefined;
}

/**
 * 業務データが実際に書かれたときにだけカレンダー同期タスクを積む INSERT を組む。
 *
 * draft が null の場合は何も積まない（空配列を返す）。
 * 業務データの条件付き書き込みが 0 件だったときは、guard の条件に一致する行が存在しないため、
 * INSERT ... SELECT も 0 件となりタスクは積まれない。
 */
export const guardedCalendarSyncTaskInserts = (
  db: Database,
  draft: CalendarSyncTaskDraft | null,
  guard: CalendarSyncTaskGuard,
): readonly BatchItem<"sqlite">[] => {
  if (draft === null) {
    return [];
  }

  const now = new Date();
  const values = toCalendarSyncTaskValues(draft, now);

  const statement = db
    .insert(calendarSyncTaskTable)
    .select(db.select(toCalendarSyncTaskProjection(values)).from(guard.from).where(guard.where));

  return [statement];
};
