/**
 * 施設の更新（UC-015）と無効化（UC-016 / COND-003）の SQL を、本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Repository を偽物に差し替えるので、更新文の条件の誤りは素通りする。
 * ここでは、写真を条件にした更新（楽観的ロック）と、無効化を止める予約の条件（`NOT EXISTS`）を実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vitest";

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

const updateInput = (overrides: Partial<UpdateFacilityInput>): UpdateFacilityInput => ({
  id: "fac_with_photo",
  name: "新しい名前",
  description: null,
  photoUrl: "/facility-photos/p0.jpg",
  expectedPhotoUrl: "/facility-photos/p0.jpg",
  googleCalendarId: null,
  calendarUrl: null,
  updatedAt: NOW,
  ...overrides,
});

describe("施設の更新（update）", () => {
  it("読んだときの写真のままなら更新する", async () => {
    const db = testDb.db;

    const result = await createFacilityRepository(db).update(
      updateInput({ photoUrl: "/facility-photos/p1.jpg" }),
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      name: "新しい名前",
      photoUrl: "/facility-photos/p1.jpg",
    });
  });

  it("写真が無い施設は、写真が無いまま（null）なら更新する", async () => {
    const db = testDb.db;

    const result = await createFacilityRepository(db).update(
      updateInput({ id: "fac_no_photo", photoUrl: null, expectedPhotoUrl: null }),
    );

    expect(result._unsafeUnwrap().name).toBe("新しい名前");
  });

  it("読んでから書くまでの間に写真が変わっていたら Conflict で、行を書き換えない", async () => {
    const db = testDb.db;
    // 別の人が先に写真を差し替えた
    await testDb.seed([
      `UPDATE "facility" SET photo_url = ? WHERE id = ?`,
      "/facility-photos/p1.jpg",
      "fac_with_photo",
    ]);

    const result = await createFacilityRepository(db).update(updateInput({}));

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
    const row = await testDb.d1
      .prepare(`SELECT name, photo_url FROM "facility" WHERE id = ?`)
      .bind("fac_with_photo")
      .first();
    expect(row).toEqual({ name: "写真のある施設", photo_url: "/facility-photos/p1.jpg" });
  });

  it("写真が無いと読んだのに、先に写真が付いていたら Conflict になる", async () => {
    const db = testDb.db;
    await testDb.seed([
      `UPDATE "facility" SET photo_url = ? WHERE id = ?`,
      "/facility-photos/p1.jpg",
      "fac_no_photo",
    ]);

    const result = await createFacilityRepository(db).update(
      updateInput({ id: "fac_no_photo", photoUrl: null, expectedPhotoUrl: null }),
    );

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.Conflict);
  });

  it("施設が無ければ、Conflict ではなく NotFound になる", async () => {
    const db = testDb.db;

    const result = await createFacilityRepository(db).update(updateInput({ id: "fac_missing" }));

    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.NotFound);
  });
});

describe("施設の無効化（COND-003: countBlockingReservations / updateActiveStatus）", () => {
  const deactivate = (db: Database) =>
    createFacilityRepository(db).updateActiveStatus({
      id: "fac_no_photo",
      from: true,
      to: false,
      updatedAt: NOW,
      now: NOW,
    });

  it.each([
    ["開始前の仮予約", "provisional", 1, 2],
    ["開始時刻を過ぎたが終了前の仮予約", "provisional", -1, 1],
    ["開始前の承認済み予約", "approved", 1, 2],
  ])("%s があると数に入り、無効化しない", async (_, status, start, end) => {
    const db = testDb.db;
    await insertReservation("rsv_1", status, start, end);

    const count = await createFacilityRepository(db).countBlockingReservations("fac_no_photo", NOW);
    const result = await deactivate(db);

    expect(count._unsafeUnwrap()).toBe(1);
    expect(result._unsafeUnwrapErr().code).toBe(FacilityErrorCode.InvalidTransition);
  });

  it.each([
    ["使用中の承認済み予約", "approved", -1, 1],
    ["終了した仮予約", "provisional", -2, -1],
    ["終了時刻がちょうど今の仮予約", "provisional", -1, 0],
    ["開始前の取り消し済み予約", "withdrawn", 1, 2],
    ["開始前の却下済み予約", "rejected", 1, 2],
    ["開始前のキャンセル済み予約", "cancelled", 1, 2],
    ["開始前の事務局キャンセル済み予約", "cancelled_by_staff", 1, 2],
  ])("%s だけなら数に入らず、無効化する", async (_, status, start, end) => {
    const db = testDb.db;
    await insertReservation("rsv_1", status, start, end);

    const count = await createFacilityRepository(db).countBlockingReservations("fac_no_photo", NOW);
    const result = await deactivate(db);

    expect(count._unsafeUnwrap()).toBe(0);
    expect(result._unsafeUnwrap().isActive).toBe(false);
  });

  it("再有効化は予約があっても止めない", async () => {
    const db = testDb.db;
    await testDb.seed([`UPDATE "facility" SET is_active = 0 WHERE id = ?`, "fac_no_photo"]);
    await insertReservation("rsv_1", "provisional", 1, 2);

    const result = await createFacilityRepository(db).updateActiveStatus({
      id: "fac_no_photo",
      from: false,
      to: true,
      updatedAt: NOW,
      now: NOW,
    });

    expect(result._unsafeUnwrap().isActive).toBe(true);
  });
});
