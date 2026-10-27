import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "../d1-test-seeds";
import { createReservationReadRepository } from "./reservation-read-repo";

const USER_ID = "usr_reader";
const RESERVATION_1 = "res_001";
const RESERVATION_2 = "res_002";
const FACILITY_ID = "fac_001";
const GROUP_ID = "grp_001";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_ID, name: "テスト読者", email: "reader@ecs.osaka-u.ac.jp" }),
    seedGroup({ id: GROUP_ID, name: "テスト団体" }),
    seedFacility({ id: FACILITY_ID, name: "テスト施設" }),
    seedReservation({
      id: RESERVATION_1,
      groupId: GROUP_ID,
      facilityId: FACILITY_ID,
      startAt: new Date(1000),
      endAt: new Date(2000),
      headCount: 5,
      status: ReservationStatus.Approved,
      createdBy: USER_ID,
    }),
    seedReservation({
      id: RESERVATION_2,
      groupId: GROUP_ID,
      facilityId: FACILITY_ID,
      startAt: new Date(3000),
      endAt: new Date(4000),
      headCount: 5,
      status: ReservationStatus.Approved,
      createdBy: USER_ID,
    }),
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
