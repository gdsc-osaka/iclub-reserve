import { and, eq, exists, getTableColumns, gte, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { calendarSyncTaskTable, reservationTable } from "~/db/schema";
import { CalendarSyncStatus, type CalendarSyncTaskDraft } from "~/domain/calendar";
import { ReservationStatus } from "~/domain/reservation";

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

/**
 * 施設変更時にまとめて同期タスクを積む際の SELECT 側に並べる列。
 */
const toFacilityCalendarSyncTaskProjection = (now: Date) => ({
  id: sql<number>`NULL`.as(calendarSyncTaskColumns.id.name),
  reservationId: sql<string>`${reservationTable.id}`.as(calendarSyncTaskColumns.reservationId.name),
  previousFacilityId: sql<string | null>`NULL`.as(calendarSyncTaskColumns.previousFacilityId.name),

  status:
    sql<CalendarSyncStatus>`${sql.param(CalendarSyncStatus.Pending, calendarSyncTaskColumns.status)}`.as(
      calendarSyncTaskColumns.status.name,
    ),
  attemptCount: sql<number>`${sql.param(0, calendarSyncTaskColumns.attemptCount)}`.as(
    calendarSyncTaskColumns.attemptCount.name,
  ),
  nextAttemptAt: sql<Date>`${sql.param(now, calendarSyncTaskColumns.nextAttemptAt)}`.as(
    calendarSyncTaskColumns.nextAttemptAt.name,
  ),
  lastError: sql<string | null>`NULL`.as(calendarSyncTaskColumns.lastError.name),
  createdAt: sql<Date>`${sql.param(now, calendarSyncTaskColumns.createdAt)}`.as(
    calendarSyncTaskColumns.createdAt.name,
  ),
  updatedAt: sql<Date>`${sql.param(now, calendarSyncTaskColumns.updatedAt)}`.as(
    calendarSyncTaskColumns.updatedAt.name,
  ),
});

/**
 * 施設の更新時に、その施設の承認済み予約をまとめてカレンダー同期タスクに積む INSERT を組む。
 *
 * resync が null の場合は何も積まない（空配列を返す）。
 * 施設の条件付き更新が失敗（0 件）したときは guard の条件を満たす行が存在しないため、
 * EXISTS 句によって INSERT ... SELECT も 0 件となりタスクは積まれない。
 */
export const guardedFacilityCalendarSyncTaskInserts = (
  db: Database,
  resync: { readonly facilityId: string; readonly rangeStart: Date } | null,
  guard: CalendarSyncTaskGuard,
): readonly BatchItem<"sqlite">[] => {
  if (resync === null) {
    return [];
  }

  const now = new Date();
  const statement = db.insert(calendarSyncTaskTable).select(
    db
      .select(toFacilityCalendarSyncTaskProjection(now))
      .from(reservationTable)
      .where(
        and(
          eq(reservationTable.facilityId, resync.facilityId),
          eq(reservationTable.status, ReservationStatus.Approved),
          gte(reservationTable.endAt, resync.rangeStart),
          exists(
            db
              .select({ one: sql`1` })
              .from(guard.from)
              .where(guard.where),
          ),
        ),
      ),
  );

  return [statement];
};

/**
 * 1 つの INSERT 文で挿入する同期タスクのチャンクサイズ。
 *
 * Cloudflare D1 では 1 クエリあたりのバインド変数が最大 100 個に制限されている。
 * 1 行あたり 8 個のパラメータ（reservationId, previousFacilityId, status, attemptCount, nextAttemptAt, lastError, createdAt, updatedAt）
 * を使用するため、1 チャンク最大 10 行（80 パラメータ）に分割することで上限（100 個）を確実に下回るようにする。
 */
export const CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE = 10;

/**
 * 日次突き合わせで導出した同期タスクの草稿を calendar_sync_task に積む INSERT 文の配列を組み立てる。
 *
 * 業務データの更新は伴わないため guard は不要。
 * D1 の 1 文あたりのバインド変数上限（100 件）を超えないよう、CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE ごとに文を分割する。
 */
export const reconcileCalendarSyncTaskInserts = (
  db: Database,
  drafts: readonly CalendarSyncTaskDraft[],
  now: Date = new Date(),
): readonly BatchItem<"sqlite">[] => {
  if (drafts.length === 0) {
    return [];
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < drafts.length; i += CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE) {
    const chunk = drafts.slice(i, i + CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE);
    const values = chunk.map((draft) => ({
      reservationId: draft.reservationId,
      previousFacilityId: draft.previousFacilityId,
      status: CalendarSyncStatus.Pending,
      attemptCount: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }));
    statements.push(db.insert(calendarSyncTaskTable).values(values));
  }

  return statements;
};
