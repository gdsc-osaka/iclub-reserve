import { beforeEach, describe, expect, it } from "vitest";

import { useD1TestDb } from "../d1-test-db";
import { createReservationReadRepository } from "./reservation-read-repo";

const USER_ID = "usr_reader";
const RESERVATION_1 = "res_001";
const RESERVATION_2 = "res_002";
const FACILITY_ID = "fac_001";
const GROUP_ID = "grp_001";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      USER_ID,
      "テスト読者",
      "reader@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      GROUP_ID,
      "テスト団体",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      FACILITY_ID,
      "テスト施設",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      RESERVATION_1,
      GROUP_ID,
      FACILITY_ID,
      1000,
      2000,
      5,
      "approved",
      USER_ID,
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      RESERVATION_2,
      GROUP_ID,
      FACILITY_ID,
      3000,
      4000,
      5,
      "approved",
      USER_ID,
      0,
      0,
    ],
  );
});

describe("ReservationReadRepository (D1)", () => {
  it("新規の既読日時を記録できる", async () => {
    const repo = createReservationReadRepository(testDb.db);
    const readAt = new Date("2026-10-14T15:00:00+09:00");

    const result = await repo.upsert(USER_ID, RESERVATION_1, readAt);
    expect(result.isOk()).toBe(true);

    const record = await repo.findByUserAndReservation(USER_ID, RESERVATION_1);
    expect(record.isOk()).toBe(true);
    expect(record._unsafeUnwrap()).toEqual({
      userId: USER_ID,
      reservationId: RESERVATION_1,
      lastReadAt: readAt,
    });
  });

  it("より新しい日時が渡された場合は last_read_at を進める", async () => {
    const repo = createReservationReadRepository(testDb.db);
    const firstRead = new Date("2026-10-14T15:00:00+09:00");
    const secondRead = new Date("2026-10-14T16:00:00+09:00");

    await repo.upsert(USER_ID, RESERVATION_1, firstRead);
    await repo.upsert(USER_ID, RESERVATION_1, secondRead);

    const record = await repo.findByUserAndReservation(USER_ID, RESERVATION_1);
    expect(record.isOk()).toBe(true);
    expect(record._unsafeUnwrap()?.lastReadAt.getTime()).toBe(secondRead.getTime());
  });

  it("過去の日時が渡されても last_read_at を後ろに戻さない", async () => {
    const repo = createReservationReadRepository(testDb.db);
    const laterRead = new Date("2026-10-14T16:00:00+09:00");
    const earlierRead = new Date("2026-10-14T14:00:00+09:00");

    await repo.upsert(USER_ID, RESERVATION_1, laterRead);
    // 過去の日時で再度 upsert
    await repo.upsert(USER_ID, RESERVATION_1, earlierRead);

    const record = await repo.findByUserAndReservation(USER_ID, RESERVATION_1);
    expect(record.isOk()).toBe(true);
    // 後の日時のまま変わらないこと
    expect(record._unsafeUnwrap()?.lastReadAt.getTime()).toBe(laterRead.getTime());
  });

  it("upsertMany で複数の予約をまとめて既読にでき、last_read_at を後ろに戻さない", async () => {
    const repo = createReservationReadRepository(testDb.db);
    const existingRead = new Date("2026-10-14T17:00:00+09:00");
    await repo.upsert(USER_ID, RESERVATION_1, existingRead);

    const batchRead = new Date("2026-10-14T16:00:00+09:00");
    const result = await repo.upsertMany(USER_ID, [RESERVATION_1, RESERVATION_2], batchRead);
    expect(result.isOk()).toBe(true);

    const res1 = await repo.findByUserAndReservation(USER_ID, RESERVATION_1);
    const res2 = await repo.findByUserAndReservation(USER_ID, RESERVATION_2);

    // RESERVATION_1 は existingRead（17:00）のまま戻らない
    expect(res1._unsafeUnwrap()?.lastReadAt.getTime()).toBe(existingRead.getTime());
    // RESERVATION_2 は batchRead（16:00）で新規登録される
    expect(res2._unsafeUnwrap()?.lastReadAt.getTime()).toBe(batchRead.getTime());
  });
});
