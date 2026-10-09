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
