import { describe, expect, it } from "vitest";

import { calendarSyncTaskTable } from "~/db/schema";
import { CalendarErrorCode, CalendarSyncStatus, type CalendarError } from "~/domain/calendar";
import { useD1TestDb } from "../d1-test-db";
import { CALENDAR_SYNC_STUCK_AFTER_MS, createD1CalendarSyncTasks } from "./d1-calendar-sync-tasks";

const testDb = useD1TestDb();

const now = new Date("2026-10-08T12:00:00.000Z");

const insertTask = async (task: {
  id?: number;
  reservationId: string;
  previousFacilityId?: string | null;
  status?: CalendarSyncStatus;
  attemptCount?: number;
  nextAttemptAt?: Date;
  updatedAt?: Date;
}) => {
  const [row] = await testDb.db
    .insert(calendarSyncTaskTable)
    .values({
      reservationId: task.reservationId,
      previousFacilityId: task.previousFacilityId ?? null,
      status: task.status ?? CalendarSyncStatus.Pending,
      attemptCount: task.attemptCount ?? 0,
      nextAttemptAt: task.nextAttemptAt ?? now,
      createdAt: now,
      updatedAt: task.updatedAt ?? now,
    })
    .returning();
  return row!;
};

describe("createD1CalendarSyncTasks", () => {
  describe("claimDue", () => {
    it("pending で nextAttemptAt <= now の行が processing になり取得される", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const row = await insertTask({
        reservationId: "res_1",
        status: CalendarSyncStatus.Pending,
        nextAttemptAt: new Date(now.getTime() - 1000),
      });

      const result = await tasks.claimDue({ now, limit: 10 });
      expect(result.isOk()).toBe(true);

      const claimed = result._unsafeUnwrap();
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        id: row.id,
        reservationId: "res_1",
        attemptCount: 0,
      });

      // DB 上で processing に進んでいること
      const [updated] = await testDb.db.select().from(calendarSyncTaskTable);
      expect(updated?.status).toBe(CalendarSyncStatus.Processing);
      expect(updated?.updatedAt.getTime()).toBe(now.getTime());
    });

    it("processing のまま 5 分以上放置された行が回収される", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const stuckTime = new Date(now.getTime() - CALENDAR_SYNC_STUCK_AFTER_MS - 1000);
      const row = await insertTask({
        reservationId: "res_stuck",
        status: CalendarSyncStatus.Processing,
        updatedAt: stuckTime,
      });

      const result = await tasks.claimDue({ now, limit: 10 });
      expect(result.isOk()).toBe(true);

      const claimed = result._unsafeUnwrap();
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(row.id);
    });

    it("pending でも未来の時刻の行は取得されない", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      await insertTask({
        reservationId: "res_future",
        status: CalendarSyncStatus.Pending,
        nextAttemptAt: new Date(now.getTime() + 60_000),
      });

      const result = await tasks.claimDue({ now, limit: 10 });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it("dead の行は取得されない", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      await insertTask({
        reservationId: "res_dead",
        status: CalendarSyncStatus.Dead,
        nextAttemptAt: new Date(now.getTime() - 1000),
      });

      const result = await tasks.claimDue({ now, limit: 10 });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it("limit 件数まで、古い順に取得される", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const t1 = await insertTask({
        reservationId: "res_older",
        nextAttemptAt: new Date(now.getTime() - 2000),
      });
      await insertTask({
        reservationId: "res_newer",
        nextAttemptAt: new Date(now.getTime() - 1000),
      });

      const result = await tasks.claimDue({ now, limit: 1 });
      expect(result.isOk()).toBe(true);

      const claimed = result._unsafeUnwrap();
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(t1.id);
    });
  });

  describe("complete", () => {
    it("成功したタスク行を削除する（ADR-008）", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const row1 = await insertTask({ reservationId: "res_1" });
      const row2 = await insertTask({ reservationId: "res_2" });

      const result = await tasks.complete([row1.id]);
      expect(result.isOk()).toBe(true);

      const rows = await testDb.db.select().from(calendarSyncTaskTable);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(row2.id);
    });
  });

  describe("fail", () => {
    it("再試行不可のエラー（Forbidden など）は直ちに dead になり last_error が記録される", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const row = await insertTask({
        reservationId: "res_perm_fail",
        attemptCount: 0,
      });

      const permError: CalendarError = {
        code: CalendarErrorCode.Forbidden,
        message: "カレンダーへの書き込み権限がありません",
      };

      const result = await tasks.fail({
        ids: [row.id],
        error: permError,
        now,
      });
      expect(result.isOk()).toBe(true);

      const [updated] = await testDb.db.select().from(calendarSyncTaskTable);
      expect(updated?.status).toBe(CalendarSyncStatus.Dead);
      expect(updated?.attemptCount).toBe(0);
      expect(updated?.lastError).toContain("CALENDAR_FORBIDDEN");
    });

    it("再試行可能のエラー（Unavailable）は attemptCount が増えて backoff され pending に戻る", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const row = await insertTask({
        reservationId: "res_retryable",
        attemptCount: 0,
      });

      const retryError: CalendarError = {
        code: CalendarErrorCode.Unavailable,
        message: "Google API が一時的に利用できません",
      };

      const result = await tasks.fail({
        ids: [row.id],
        error: retryError,
        now,
      });
      expect(result.isOk()).toBe(true);

      const [updated] = await testDb.db.select().from(calendarSyncTaskTable);
      expect(updated?.status).toBe(CalendarSyncStatus.Pending);
      expect(updated?.attemptCount).toBe(1);
      // 30 秒 * 2^0 = 30 秒後
      expect(updated?.nextAttemptAt.getTime()).toBe(now.getTime() + 30_000);
      expect(updated?.lastError).toContain("CALENDAR_UNAVAILABLE");
    });

    it("6 回目の試行（attemptCount が 5 で失敗）は dead に落とされる", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const row = await insertTask({
        reservationId: "res_max_retry",
        attemptCount: 5,
      });

      const retryError: CalendarError = {
        code: CalendarErrorCode.RateLimited,
        message: "レート制限超過",
      };

      const result = await tasks.fail({
        ids: [row.id],
        error: retryError,
        now,
      });
      expect(result.isOk()).toBe(true);

      const [updated] = await testDb.db.select().from(calendarSyncTaskTable);
      expect(updated?.status).toBe(CalendarSyncStatus.Dead);
      expect(updated?.attemptCount).toBe(6);
    });
  });

  describe("enqueue", () => {
    it("draft を処理待ちの行として積み、すぐに取り出せるようにする", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const result = await tasks.enqueue({
        drafts: [
          { reservationId: "res_1", previousFacilityId: null },
          { reservationId: "res_1", previousFacilityId: "fac_old" },
        ],
        now,
      });
      expect(result.isOk()).toBe(true);

      const rows = await testDb.db.select().from(calendarSyncTaskTable);
      expect(
        rows.map((row) => ({
          reservationId: row.reservationId,
          previousFacilityId: row.previousFacilityId,
          status: row.status,
          attemptCount: row.attemptCount,
          nextAttemptAt: row.nextAttemptAt,
        })),
      ).toEqual([
        {
          reservationId: "res_1",
          previousFacilityId: null,
          status: CalendarSyncStatus.Pending,
          attemptCount: 0,
          nextAttemptAt: now,
        },
        {
          reservationId: "res_1",
          previousFacilityId: "fac_old",
          status: CalendarSyncStatus.Pending,
          attemptCount: 0,
          nextAttemptAt: now,
        },
      ]);
    });

    it("1 文のバインド変数の上限を超える件数でも、すべて積める", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const drafts = Array.from({ length: 25 }, (_, i) => ({
        reservationId: `res_${i}`,
        previousFacilityId: null,
      }));

      const result = await tasks.enqueue({ drafts, now });
      expect(result.isOk()).toBe(true);

      const rows = await testDb.db.select().from(calendarSyncTaskTable);
      expect(rows).toHaveLength(25);
    });

    it("draft が無ければ何も積まない", async () => {
      const tasks = createD1CalendarSyncTasks(testDb.db);
      const result = await tasks.enqueue({ drafts: [], now });
      expect(result.isOk()).toBe(true);

      const rows = await testDb.db.select().from(calendarSyncTaskTable);
      expect(rows).toHaveLength(0);
    });
  });
});
