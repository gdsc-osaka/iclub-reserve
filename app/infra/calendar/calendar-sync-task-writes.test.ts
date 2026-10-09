import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { facilityTable, reservationTable } from "~/db/schema";
import type { CalendarSyncTaskDraft } from "~/domain/calendar";

import {
  guardedCalendarSyncTaskInserts,
  guardedFacilityCalendarSyncTaskInserts,
  reconcileCalendarSyncTaskInserts,
  CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE,
  type CalendarSyncTaskGuard,
} from "./calendar-sync-task-writes";

const toSQL = (statement: BatchItem<"sqlite">) =>
  (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

const db = drizzle(undefined as unknown as D1Database, { schema });

const draft: CalendarSyncTaskDraft = {
  reservationId: "res_test_123",
  previousFacilityId: "fac_prev_456",
};

/** calendar_sync_task の列（定義順） */
const columns = [
  "id",
  "reservation_id",
  "previous_facility_id",
  "status",
  "attempt_count",
  "next_attempt_at",
  "last_error",
  "created_at",
  "updated_at",
];

describe("guardedCalendarSyncTaskInserts", () => {
  const guard: CalendarSyncTaskGuard = {
    from: reservationTable,
    where: eq(reservationTable.id, "res_test_123"),
  };

  it("draft が null のときは空配列を返す", () => {
    const statements = guardedCalendarSyncTaskInserts(db, null, guard);
    expect(statements).toHaveLength(0);
  });

  it("draft があるときは 1 つの文を返す", () => {
    const statements = guardedCalendarSyncTaskInserts(db, draft, guard);
    expect(statements).toHaveLength(1);
  });

  it("業務データの表を読む INSERT ... SELECT になり、条件が末尾に付く", () => {
    const [statement] = guardedCalendarSyncTaskInserts(db, draft, guard);
    const { sql, params } = toSQL(statement!);

    expect(sql).toContain("insert into");
    expect(sql).toContain(`"calendar_sync_task"`);
    expect(sql).toContain("select");
    expect(sql).toContain(`from "reservation"`);
    expect(sql).toContain(`"reservation"."id" = ?`);
    expect(params.at(-1)).toBe("res_test_123");
  });

  it("SELECT 側の列も定義順（id を含む）にそろえる", () => {
    const [statement] = guardedCalendarSyncTaskInserts(db, draft, guard);
    const { sql } = toSQL(statement!);

    const positions = columns.map((column) => sql.indexOf(`as "${column}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("CalendarSyncTaskDraft の内容を列に写し、日時はミリ秒の整数で渡す", () => {
    const [statement] = guardedCalendarSyncTaskInserts(db, draft, guard);
    const { params } = toSQL(statement!);

    expect(params.slice(0, 9)).toEqual([
      null,
      "res_test_123",
      "fac_prev_456",
      "pending",
      0,
      expect.any(Number),
      null,
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it("previousFacilityId が null の場合も正しく null が渡る", () => {
    const [statement] = guardedCalendarSyncTaskInserts(
      db,
      { reservationId: "res_test_123", previousFacilityId: null },
      guard,
    );
    const { params } = toSQL(statement!);

    expect(params[2]).toBeNull();
  });
});

describe("guardedFacilityCalendarSyncTaskInserts", () => {
  const guard: CalendarSyncTaskGuard = {
    from: facilityTable,
    where: eq(facilityTable.id, "fac_test_123"),
  };
  const rangeStart = new Date("2026-10-01T00:00:00Z");

  it("resync が null のときは空配列を返す", () => {
    const statements = guardedFacilityCalendarSyncTaskInserts(db, null, guard);
    expect(statements).toHaveLength(0);
  });

  it("resync があるときは 1 つの文を返す", () => {
    const statements = guardedFacilityCalendarSyncTaskInserts(
      db,
      { facilityId: "fac_test_123", rangeStart },
      guard,
    );
    expect(statements).toHaveLength(1);
  });

  it("予約テーブルから承認済み・指定施設・終了日時以降を SELECT して INSERT し、guard の EXISTS 条件が付く", () => {
    const [statement] = guardedFacilityCalendarSyncTaskInserts(
      db,
      { facilityId: "fac_test_123", rangeStart },
      guard,
    );
    const { sql, params } = toSQL(statement!);

    expect(sql).toContain("insert into");
    expect(sql).toContain(`"calendar_sync_task"`);
    expect(sql).toContain("select");
    expect(sql).toContain(`from "reservation"`);
    expect(sql).toContain(`"reservation"."facility_id" = ?`);
    expect(sql).toContain(`"reservation"."status" = ?`);
    expect(sql).toContain(`"reservation"."end_at" >= ?`);
    expect(sql).toContain(`exists (select 1 from "facility" where "facility"."id" = ?)`);

    expect(params).toContain("fac_test_123");
    expect(params).toContain("approved");
    expect(params).toContain(rangeStart.getTime());
  });

  it("SELECT 側の列も定義順（id を含む）にそろえる", () => {
    const [statement] = guardedFacilityCalendarSyncTaskInserts(
      db,
      { facilityId: "fac_test_123", rangeStart },
      guard,
    );
    const { sql } = toSQL(statement!);

    const positions = columns.map((column) => sql.indexOf(`as "${column}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("reconcileCalendarSyncTaskInserts", () => {
  const now = new Date("2026-10-10T10:00:00.000Z");

  it("draft が空配列のときは空配列を返す", () => {
    const statements = reconcileCalendarSyncTaskInserts(db, [], now);
    expect(statements).toHaveLength(0);
  });

  it("draft があるときは INSERT 文を生成し、各列に正しい値が入る", () => {
    const drafts: CalendarSyncTaskDraft[] = [
      { reservationId: "res_1", previousFacilityId: null },
      { reservationId: "res_2", previousFacilityId: "fac_prev_old" },
    ];

    const statements = reconcileCalendarSyncTaskInserts(db, drafts, now);
    expect(statements).toHaveLength(1);

    const { sql, params } = toSQL(statements[0]!);
    expect(sql).toContain("insert into");
    expect(sql).toContain(`"calendar_sync_task"`);
    expect(sql).toContain("values");

    // 1 行あたり 8 パラメータ（reservation_id, previous_facility_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at）
    expect(params).toHaveLength(2 * 8);

    // 1行目
    expect(params.slice(0, 8)).toEqual([
      "res_1",
      null,
      "pending",
      0,
      now.getTime(),
      null,
      now.getTime(),
      now.getTime(),
    ]);

    // 2行目
    expect(params.slice(8, 16)).toEqual([
      "res_2",
      "fac_prev_old",
      "pending",
      0,
      now.getTime(),
      null,
      now.getTime(),
      now.getTime(),
    ]);
  });

  it("D1 のバインド変数上限（100個）を超えないよう CHUNK_SIZE ごとに文を分割する", () => {
    // 25 件の draft を作成
    const drafts: CalendarSyncTaskDraft[] = Array.from({ length: 25 }, (_, i) => ({
      reservationId: `res_${i}`,
      previousFacilityId: i % 2 === 0 ? `fac_${i}` : null,
    }));

    const statements = reconcileCalendarSyncTaskInserts(db, drafts, now);

    // CHUNK_SIZE が 10 のため、25 件は 10 + 10 + 5 の 3 文に分割される
    expect(statements).toHaveLength(Math.ceil(25 / CALENDAR_SYNC_TASK_INSERT_CHUNK_SIZE));
    expect(statements).toHaveLength(3);

    // すべての文においてバインド変数の数が 100 以下であることを検証（D1_ERROR: too many SQL variables を防止）
    for (const statement of statements) {
      const { params } = toSQL(statement);
      expect(params.length).toBeLessThanOrEqual(100);
      expect(params.length).toBeGreaterThan(0);
    }

    const { params: params1 } = toSQL(statements[0]!);
    expect(params1).toHaveLength(10 * 8); // 80 変数

    const { params: params2 } = toSQL(statements[1]!);
    expect(params2).toHaveLength(10 * 8); // 80 変数

    const { params: params3 } = toSQL(statements[2]!);
    expect(params3).toHaveLength(5 * 8); // 40 変数
  });
});
