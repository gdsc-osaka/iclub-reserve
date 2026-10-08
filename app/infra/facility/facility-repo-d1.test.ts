/**
 * 施設の更新（UC-015）と無効化（UC-016 / COND-003）の SQL を、本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Repository を偽物に差し替えるので、更新文の条件の誤りは素通りする。
 * ここでは、写真を条件にした更新（楽観的ロック）と、無効化を止める予約の条件（`NOT EXISTS`）を実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AuditLogAction, AuditLogChanges, AuditLogDraft } from "~/domain/audit-log";
import { FacilityErrorCode, type UpdateFacilityInput } from "~/domain/facility";
import { createFacilityRepository } from "./facility-repo";
import { useD1TestDb } from "../d1-test-db";
import type { Database } from "../db";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_taro",
      "太郎",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_robotics",
      "ロボット部",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, photo_url, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_with_photo",
      "写真のある施設",
      "/facility-photos/p0.jpg",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, photo_url, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_no_photo",
      "写真の無い施設",
      null,
      1,
      0,
      0,
    ],
  );
});

const insertReservation = async (
  id: string,
  status: string,
  startHoursFromNow: number,
  endHoursFromNow: number,
) => {
  await testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    "grp_robotics",
    "fac_no_photo",
    NOW.getTime() + startHoursFromNow * HOUR,
    NOW.getTime() + endHoursFromNow * HOUR,
    1,
    status,
    "usr_taro",
    0,
    0,
  ]);
};

/** 基準の現在時刻（2026-10-01 12:00 UTC） */
const NOW = new Date("2026-10-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const dummyAuditLog = (
  action: AuditLogAction,
  targetId: string,
  changes: AuditLogChanges = {},
): AuditLogDraft => ({
  occurredAt: NOW,
  actorId: "usr_taro",
  actedAsStaff: true,
  action,
  targetId,
  groupId: null,
  changes,
});

const countAuditLogs = async (targetId: string): Promise<number> => {
  const row = await testDb.d1
    .prepare(`SELECT COUNT(*) as count FROM "audit_log" WHERE target_id = ?`)
    .bind(targetId)
    .first<{ count: number }>();
  return row?.count ?? 0;
};

const updateInput = (overrides: Partial<UpdateFacilityInput>): UpdateFacilityInput => ({
  id: "fac_with_photo",
  name: "新しい名前",
  description: null,
  photoUrl: "/facility-photos/p1.jpg",
  expectedPhotoUrl: "/facility-photos/p0.jpg",
  googleCalendarId: null,
  calendarUrl: null,
  updatedAt: NOW,
  ...overrides,
});

describe("施設の登録（create）", () => {
  it("施設と操作履歴を同じ batch で書き込む", async () => {
    const db = testDb.db;
    const auditLog = dummyAuditLog("facility.create", "fac_new", {
      name: { before: null, after: "新施設" },
    });

    const result = await createFacilityRepository(db).create(
      {
        id: "fac_new",
        name: "新施設",
        description: null,
        photoUrl: null,
        googleCalendarId: null,
        calendarUrl: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
      auditLog,
    );

    expect(result._unsafeUnwrap().id).toBe("fac_new");
    expect(await countAuditLogs("fac_new")).toBe(1);
    const logRow = await testDb.d1
      .prepare(
        `SELECT action, actor_id, acted_as_staff, target_type, target_id FROM "audit_log" WHERE target_id = ?`,
      )
      .bind("fac_new")
      .first();
    expect(logRow).toEqual({
      action: "facility.create",
      actor_id: "usr_taro",
      acted_as_staff: 1,
      target_type: "facility",
      target_id: "fac_new",
    });
  });
});

describe("施設の更新（update）", () => {
  it("読んだときの写真のままなら更新し、操作履歴を 1 行書く", async () => {
    const db = testDb.db;
    const input = updateInput({ photoUrl: "/facility-photos/p1.jpg" });
    const auditLog = dummyAuditLog("facility.update", input.id, {
      name: { before: "写真のある施設", after: "新しい名前" },
    });

    const result = await createFacilityRepository(db).update(input, auditLog);

    expect(result._unsafeUnwrap()).toMatchObject({
      name: "新しい名前",
      photoUrl: "/facility-photos/p1.jpg",
    });
    expect(await countAuditLogs(input.id)).toBe(1);
  });

  it("写真が無い施設は、写真が無いまま（null）なら更新する", async () => {
    const db = testDb.db;
    const input = updateInput({ id: "fac_no_photo", photoUrl: null, expectedPhotoUrl: null });
    const auditLog = dummyAuditLog("facility.update", input.id, {
      name: { before: "写真の無い施設", after: "新しい名前" },
    });

    const result = await createFacilityRepository(db).update(input, auditLog);

    expect(result._unsafeUnwrap().name).toBe("新しい名前");
    expect(await countAuditLogs(input.id)).toBe(1);
  });

  it("読んでから書くまでの間に写真が変わっていたら Conflict で、行を書き換えず履歴も書かない", async () => {
    const db = testDb.db;
    // 別の人が先に写真を差し替えた
    await testDb.seed([
      `UPDATE "facility" SET photo_url = ? WHERE id = ?`,
      "/facility-photos/p1.jpg",
      "fac_with_photo",
    ]);

    const input = updateInput({});
    const auditLog = dummyAuditLog("facility.update", input.id);
    const result = await createFacilityRepository(db).update(input, auditLog);

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
    const row = await testDb.d1
      .prepare(`SELECT name, photo_url FROM "facility" WHERE id = ?`)
      .bind("fac_with_photo")
      .first();
    expect(row).toEqual({ name: "写真のある施設", photo_url: "/facility-photos/p1.jpg" });
    expect(await countAuditLogs(input.id)).toBe(0);
  });

  it("写真が無いと読んだのに、先に写真が付いていたら Conflict になり履歴も書かない", async () => {
    const db = testDb.db;
    await testDb.seed([
      `UPDATE "facility" SET photo_url = ? WHERE id = ?`,
      "/facility-photos/p1.jpg",
      "fac_no_photo",
    ]);

    const input = updateInput({ id: "fac_no_photo", photoUrl: null, expectedPhotoUrl: null });
    const auditLog = dummyAuditLog("facility.update", input.id);
    const result = await createFacilityRepository(db).update(input, auditLog);

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
    expect(await countAuditLogs(input.id)).toBe(0);
  });

  it("施設が無ければ、Conflict ではなく NotFound になり履歴も書かない", async () => {
    const db = testDb.db;
    const input = updateInput({ id: "fac_missing" });
    const auditLog = dummyAuditLog("facility.update", input.id);

    const result = await createFacilityRepository(db).update(input, auditLog);

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
    expect(await countAuditLogs(input.id)).toBe(0);
  });
});

describe("施設の無効化（COND-003: countBlockingReservations / updateActiveStatus）", () => {
  const deactivate = (db: Database, auditLog: AuditLogDraft) =>
    createFacilityRepository(db).updateActiveStatus(
      {
        id: "fac_no_photo",
        from: true,
        to: false,
        updatedAt: NOW,
        now: NOW,
      },
      auditLog,
    );

  it.each([
    ["開始前の仮予約", "provisional", 1, 2],
    ["開始時刻を過ぎたが終了前の仮予約", "provisional", -1, 1],
    ["開始前の承認済み予約", "approved", 1, 2],
  ])("%s があると数に入り、無効化せず履歴も書かない", async (_, status, start, end) => {
    const db = testDb.db;
    await insertReservation("rsv_1", status, start, end);

    const count = await createFacilityRepository(db).countBlockingReservations("fac_no_photo", NOW);
    const auditLog = dummyAuditLog("facility.deactivate", "fac_no_photo", {
      is_active: { before: true, after: false },
    });
    const result = await deactivate(db, auditLog);

    expect(count._unsafeUnwrap()).toBe(1);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidTransition);
    expect(await countAuditLogs("fac_no_photo")).toBe(0);
  });

  it.each([
    ["使用中の承認済み予約", "approved", -1, 1],
    ["終了した仮予約", "provisional", -2, -1],
    ["終了時刻がちょうど今の仮予約", "provisional", -1, 0],
    ["開始前の取り消し済み予約", "withdrawn", 1, 2],
    ["開始前の却下済み予約", "rejected", 1, 2],
    ["開始前のキャンセル済み予約", "cancelled", 1, 2],
    ["開始前の事務局キャンセル済み予約", "cancelled_by_staff", 1, 2],
  ])("%s だけなら数に入らず、無効化し履歴を 1 行書く", async (_, status, start, end) => {
    const db = testDb.db;
    await insertReservation("rsv_1", status, start, end);

    const count = await createFacilityRepository(db).countBlockingReservations("fac_no_photo", NOW);
    const auditLog = dummyAuditLog("facility.deactivate", "fac_no_photo", {
      is_active: { before: true, after: false },
    });
    const result = await deactivate(db, auditLog);

    expect(count._unsafeUnwrap()).toBe(0);
    expect(result._unsafeUnwrap().isActive).toBe(false);
    expect(await countAuditLogs("fac_no_photo")).toBe(1);
  });

  it("再有効化は予約があっても止めず、履歴を 1 行書く", async () => {
    const db = testDb.db;
    await testDb.seed([`UPDATE "facility" SET is_active = 0 WHERE id = ?`, "fac_no_photo"]);
    await insertReservation("rsv_1", "provisional", 1, 2);

    const auditLog = dummyAuditLog("facility.reactivate", "fac_no_photo", {
      is_active: { before: false, after: true },
    });
    const result = await createFacilityRepository(db).updateActiveStatus(
      {
        id: "fac_no_photo",
        from: false,
        to: true,
        updatedAt: NOW,
        now: NOW,
      },
      auditLog,
    );

    expect(result._unsafeUnwrap().isActive).toBe(true);
    expect(await countAuditLogs("fac_no_photo")).toBe(1);
  });
});
