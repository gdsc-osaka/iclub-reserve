import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { auditLogTable, groupTable } from "~/db/schema";
import { AuditLogAction, AuditLogTargetType, type AuditLogDraft } from "~/domain/audit-log";
import { useD1TestDb } from "../d1-test-db";
import { auditLogInsert, guardedAuditLogInsert } from "./audit-log-writes";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed([
    `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
    "grp_alpha",
    "アルファ部",
    "enabled",
    0,
    0,
  ]);
});

describe("audit-log-writes", () => {
  const dummyOccurredAt = new Date("2026-10-07T12:00:00.000Z");

  describe("auditLogInsert（無条件）", () => {
    it("1行入り、各列が正しく読み戻せる", async () => {
      const draft: AuditLogDraft = {
        occurredAt: dummyOccurredAt,
        actorId: "usr_actor",
        actedAsStaff: true,
        action: AuditLogAction.GroupCreate,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
        changes: {
          name: { before: null, after: "アルファ部" },
          status: { before: null, after: "enabled" },
        },
      };

      const statement = auditLogInsert(testDb.db, draft);
      await testDb.db.batch([statement]);

      const rows = await testDb.db.select().from(auditLogTable);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row.id).toBeDefined();
      expect(typeof row.id).toBe("string");
      expect(row.occurredAt).toEqual(dummyOccurredAt);
      expect(row.actorId).toBe("usr_actor");
      expect(row.actedAsStaff).toBe(true);
      expect(row.action).toBe(AuditLogAction.GroupCreate);
      expect(row.targetType).toBe(AuditLogTargetType.Group);
      expect(row.targetId).toBe("grp_alpha");
      expect(row.groupId).toBe("grp_alpha");
      expect(row.changes).toEqual(draft.changes);
    });
  });

  describe("guardedAuditLogInsert（条件付き）", () => {
    it("条件に合う行がある場合、ちょうど1行記録される", async () => {
      const draft: AuditLogDraft = {
        occurredAt: dummyOccurredAt,
        actorId: "usr_actor",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
        changes: {
          name: { before: "アルファ部", after: "新アルファ部" },
        },
      };

      const statement = guardedAuditLogInsert(testDb.db, draft, {
        from: groupTable,
        where: eq(groupTable.id, "grp_alpha"),
      });

      await testDb.db.batch([statement]);

      const rows = await testDb.db.select().from(auditLogTable);
      expect(rows).toHaveLength(1);
      expect(rows[0].targetId).toBe("grp_alpha");
      expect(rows[0].targetType).toBe(AuditLogTargetType.Group);
    });

    it("条件に合う行が無い場合、1行も記録されない", async () => {
      const draft: AuditLogDraft = {
        occurredAt: dummyOccurredAt,
        actorId: "usr_actor",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetId: "grp_non_existent",
        groupId: "grp_non_existent",
        changes: {
          name: { before: "旧部名", after: "新部名" },
        },
      };

      const statement = guardedAuditLogInsert(testDb.db, draft, {
        from: groupTable,
        where: eq(groupTable.id, "grp_non_existent"),
      });

      await testDb.db.batch([statement]);

      const rows = await testDb.db.select().from(auditLogTable);
      expect(rows).toHaveLength(0);
    });

    it("guard.from に SQL（SELECT 1）を渡した場合、where の条件に応じて記録される", async () => {
      const draft: AuditLogDraft = {
        occurredAt: dummyOccurredAt,
        actorId: "usr_actor",
        actedAsStaff: true,
        action: AuditLogAction.ReservationDirectCreate,
        targetId: "rsv_1",
        groupId: "grp_alpha",
        changes: {
          facility_id: { before: null, after: "fac_1" },
        },
      };

      // where が true に相当する場合 -> 1 行入る
      const hitStatement = guardedAuditLogInsert(testDb.db, draft, {
        from: sql`(SELECT 1)`,
        where: sql`1 = 1`,
      });
      await testDb.db.batch([hitStatement]);

      let rows = await testDb.db.select().from(auditLogTable);
      expect(rows).toHaveLength(1);

      // where が false に相当する場合 -> 記録されない
      const missStatement = guardedAuditLogInsert(testDb.db, draft, {
        from: sql`(SELECT 1)`,
        where: sql`1 = 0`,
      });
      await testDb.db.batch([missStatement]);

      rows = await testDb.db.select().from(auditLogTable);
      expect(rows).toHaveLength(1);
    });
  });
});
