/**
 * 今日の予約状況（findStaffTodaySchedule）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - 今日の予約状況で、日付の境目（0 時）をまたぐ予約の扱い
 * - 有効な施設・設備のみが取得される
 * - 承認済み・仮予約のみが取得され、終了した予約は除外される
 */
import { beforeEach, describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { QueryErrorCode } from "../error";
import { findStaffTodaySchedule } from "./staff-today-schedule";

const testDb = useD1TestDb();

const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };
// 2026-10-15 のお昼
const NOW = new Date("2026-10-15T12:00:00+09:00");

beforeEach(async () => {
  await testDb.seed([
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    USER_APPLICANT.id,
    USER_APPLICANT.name,
    USER_APPLICANT.email,
    1,
    0,
    0,
    0,
  ]);

  await testDb.seed(
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_test",
      "テスト団体",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_active_1",
      "アクティブ施設 1",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_inactive",
      "無効な施設",
      0,
      0,
      0,
    ],
  );
});

async function insertReservation(
  id: string,
  facilityId: string,
  startAt: Date,
  endAt: Date,
  status: ReservationStatus = ReservationStatus.Approved,
) {
  await testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    "grp_test",
    facilityId,
    startAt.getTime(),
    endAt.getTime(),
    2,
    status,
    USER_APPLICANT.id,
    0,
    0,
  ]);
}

describe("findStaffTodaySchedule", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findStaffTodaySchedule(testDb.db, { isStaff: false, now: NOW });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("有効な施設のみを取得する", async () => {
    const result = await findStaffTodaySchedule(testDb.db, { isStaff: true, now: NOW });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.facilities).toHaveLength(1);
    expect(result.value.facilities[0]?.id).toBe("fac_active_1");
  });

  it("日付の境目（0 時）をまたぐ予約の判定が正しい", async () => {
    // 1. 前日 22:00 〜 当日 00:00 (ちょうど 00:00 終了): 今日と重ならない（含まない）
    await insertReservation(
      "res_ended_midnight",
      "fac_active_1",
      new Date("2026-10-14T22:00:00+09:00"),
      new Date("2026-10-15T00:00:00+09:00"),
    );

    // 2. 前日 23:00 〜 当日 01:00 (0 時をまたぐ): 今日の予約に含まれる
    await insertReservation(
      "res_cross_start",
      "fac_active_1",
      new Date("2026-10-14T23:00:00+09:00"),
      new Date("2026-10-15T01:00:00+09:00"),
    );

    // 3. 当日中 (10:00 〜 12:00): 今日の予約に含まれる
    await insertReservation(
      "res_daytime",
      "fac_active_1",
      new Date("2026-10-15T10:00:00+09:00"),
      new Date("2026-10-15T12:00:00+09:00"),
    );

    // 4. 当日 23:00 〜 翌日 01:00 (24 時/翌 0 時をまたぐ): 今日の予約に含まれる
    await insertReservation(
      "res_cross_end",
      "fac_active_1",
      new Date("2026-10-15T23:00:00+09:00"),
      new Date("2026-10-16T01:00:00+09:00"),
    );

    // 5. 翌日 00:00 〜 翌日 02:00 (ちょうど翌日 00:00 開始): 今日と重ならない（含まない）
    await insertReservation(
      "res_starts_tomorrow",
      "fac_active_1",
      new Date("2026-10-16T00:00:00+09:00"),
      new Date("2026-10-16T02:00:00+09:00"),
    );

    const result = await findStaffTodaySchedule(testDb.db, { isStaff: true, now: NOW });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const resIds = result.value.reservations.map((r) => r.id);
    expect(resIds).toContain("res_cross_start");
    expect(resIds).toContain("res_daytime");
    expect(resIds).toContain("res_cross_end");
    expect(resIds).not.toContain("res_ended_midnight");
    expect(resIds).not.toContain("res_starts_tomorrow");
  });

  it("承認済み・仮予約のみ取得し、キャンセル等の予約は除外される", async () => {
    // 承認済み
    await insertReservation(
      "res_approved",
      "fac_active_1",
      new Date("2026-10-15T10:00:00+09:00"),
      new Date("2026-10-15T11:00:00+09:00"),
      ReservationStatus.Approved,
    );
    // 仮予約
    await insertReservation(
      "res_provisional",
      "fac_active_1",
      new Date("2026-10-15T13:00:00+09:00"),
      new Date("2026-10-15T14:00:00+09:00"),
      ReservationStatus.Provisional,
    );
    // キャンセル済み
    await insertReservation(
      "res_cancelled",
      "fac_active_1",
      new Date("2026-10-15T15:00:00+09:00"),
      new Date("2026-10-15T16:00:00+09:00"),
      ReservationStatus.Cancelled,
    );
    // 却下
    await insertReservation(
      "res_rejected",
      "fac_active_1",
      new Date("2026-10-15T17:00:00+09:00"),
      new Date("2026-10-15T18:00:00+09:00"),
      ReservationStatus.Rejected,
    );

    const result = await findStaffTodaySchedule(testDb.db, { isStaff: true, now: NOW });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const resIds = result.value.reservations.map((r) => r.id);
    expect(resIds).toEqual(["res_approved", "res_provisional"]);
  });
});
