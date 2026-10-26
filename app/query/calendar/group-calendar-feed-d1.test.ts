import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { groupCalendarFeedTable, groupMemberTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import {
  seedFacility,
  seedGroup,
  seedGroupCalendarFeed,
  seedMember,
  seedReservation,
  seedUser,
} from "~/infra/d1-test-seeds";
import { findGroupCalendarFeed } from "./group-calendar-feed";

const testDb = useD1TestDb();

const USER_ID = "usr_taro";
const OTHER_USER_ID = "usr_hanako";
const GROUP_ID = "grp_robotics";
const OTHER_GROUP_ID = "grp_ai";
const MEMBERSHIP_ID = "mem_taro";
const TOKEN_VALID = "valid_token_feed_123";
const FACILITY_ID = "fac_3d_printer";

// 基準時刻: 2026-05-01 12:00:00 (since は 2026-01-31 12:00:00)
const SINCE = new Date("2026-01-31T12:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_ID, name: "太郎", email: "taro@example.com" }),
    seedUser({ id: OTHER_USER_ID, name: "花子", email: "hanako@example.com" }),
    seedGroup({ id: GROUP_ID, name: "ロボティクス班" }),
    seedGroup({ id: OTHER_GROUP_ID, name: "AI研究班" }),
    seedFacility({ id: FACILITY_ID, name: "3Dプリンター" }),
    seedMember({ id: MEMBERSHIP_ID, groupId: GROUP_ID, userId: USER_ID }),
    seedMember({ id: "mem_hanako", groupId: OTHER_GROUP_ID, userId: OTHER_USER_ID }),
    seedGroupCalendarFeed({
      id: "feed_taro",
      membershipId: MEMBERSHIP_ID,
      token: TOKEN_VALID,
    }),
  );
});

describe("findGroupCalendarFeed", () => {
  it("存在しないトークンの場合は null を返す", async () => {
    const result = await findGroupCalendarFeed(testDb.db, {
      token: "non_existent_token",
      since: SINCE,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("自団体の仮予約・承認済みの予約のみを返し、他団体の予約は含まない", async () => {
    await testDb.seed(
      // 自団体の承認済み予約
      seedReservation({
        id: "res_own_approved",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Approved,
        startAt: new Date("2026-05-10T10:00:00.000Z"),
        endAt: new Date("2026-05-10T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
      // 自団体の仮予約
      seedReservation({
        id: "res_own_provisional",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Provisional,
        startAt: new Date("2026-05-11T10:00:00.000Z"),
        endAt: new Date("2026-05-11T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
      // 他団体の予約
      seedReservation({
        id: "res_other_approved",
        groupId: OTHER_GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Approved,
        startAt: new Date("2026-05-12T10:00:00.000Z"),
        endAt: new Date("2026-05-12T12:00:00.000Z"),
        createdBy: OTHER_USER_ID,
      }),
    );

    const result = await findGroupCalendarFeed(testDb.db, {
      token: TOKEN_VALID,
      since: SINCE,
    });

    expect(result.isOk()).toBe(true);
    const feed = result._unsafeUnwrap();
    expect(feed).not.toBeNull();
    expect(feed?.groupId).toBe(GROUP_ID);
    expect(feed?.groupName).toBe("ロボティクス班");

    const resIds = feed?.reservations.map((r) => r.id);
    expect(resIds).toEqual(["res_own_approved", "res_own_provisional"]);
  });

  it("終わった予約（キャンセル・却下・取り消し・事務局キャンセル）は含まない", async () => {
    await testDb.seed(
      seedReservation({
        id: "res_withdrawn",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Withdrawn,
        startAt: new Date("2026-05-10T10:00:00.000Z"),
        endAt: new Date("2026-05-10T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
      seedReservation({
        id: "res_rejected",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Rejected,
        startAt: new Date("2026-05-11T10:00:00.000Z"),
        endAt: new Date("2026-05-11T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
      seedReservation({
        id: "res_cancelled",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Cancelled,
        startAt: new Date("2026-05-12T10:00:00.000Z"),
        endAt: new Date("2026-05-12T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
      seedReservation({
        id: "res_staff_cancel",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.CancelledByStaff,
        startAt: new Date("2026-05-13T10:00:00.000Z"),
        endAt: new Date("2026-05-13T12:00:00.000Z"),
        createdBy: USER_ID,
      }),
    );

    const result = await findGroupCalendarFeed(testDb.db, {
      token: TOKEN_VALID,
      since: SINCE,
    });

    const feed = result._unsafeUnwrap();
    expect(feed?.reservations).toEqual([]);
  });

  it("90 日の境目: since より後に終わる予約を含み、ちょうど since に終わる予約とそれ以前に終わる予約は含まない", async () => {
    // 1. since より 1 秒後に終わる予約 -> 含む
    const afterSinceEnd = new Date(SINCE.getTime() + 1000);
    // 2. ちょうど since に終わる予約 -> 含まない（endAt > since）
    const exactSinceEnd = new Date(SINCE.getTime());
    // 3. since より前に終わる予約 -> 含まない
    const beforeSinceEnd = new Date(SINCE.getTime() - 1000);

    await testDb.seed(
      seedReservation({
        id: "res_after_since",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Approved,
        startAt: new Date(SINCE.getTime() - 3600000),
        endAt: afterSinceEnd,
        createdBy: USER_ID,
      }),
      seedReservation({
        id: "res_exact_since",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Approved,
        startAt: new Date(SINCE.getTime() - 7200000),
        endAt: exactSinceEnd,
        createdBy: USER_ID,
      }),
      seedReservation({
        id: "res_before_since",
        groupId: GROUP_ID,
        facilityId: FACILITY_ID,
        status: ReservationStatus.Approved,
        startAt: new Date(SINCE.getTime() - 10800000),
        endAt: beforeSinceEnd,
        createdBy: USER_ID,
      }),
    );

    const result = await findGroupCalendarFeed(testDb.db, {
      token: TOKEN_VALID,
      since: SINCE,
    });

    const feed = result._unsafeUnwrap();
    const resIds = feed?.reservations.map((r) => r.id);
    expect(resIds).toEqual(["res_after_since"]);
  });

  it("所属（group_member）が削除されるとカスケードにより購読行が消え、結果は null になる", async () => {
    // 所属行を削除する
    await testDb.db.delete(groupMemberTable).where(eq(groupMemberTable.id, MEMBERSHIP_ID));

    const result = await findGroupCalendarFeed(testDb.db, {
      token: TOKEN_VALID,
      since: SINCE,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("作り直す前の古いトークンは null になる", async () => {
    // トークンを作り直して更新する
    const NEW_TOKEN = "new_regenerated_token_456";
    await testDb.db
      .update(groupCalendarFeedTable)
      .set({ token: NEW_TOKEN, updatedAt: new Date() })
      .where(eq(groupCalendarFeedTable.token, TOKEN_VALID));

    // 古いトークンで問い合わせ
    const oldResult = await findGroupCalendarFeed(testDb.db, {
      token: TOKEN_VALID,
      since: SINCE,
    });
    expect(oldResult._unsafeUnwrap()).toBeNull();

    // 新しいトークンで問い合わせ
    const newResult = await findGroupCalendarFeed(testDb.db, {
      token: NEW_TOKEN,
      since: SINCE,
    });
    expect(newResult._unsafeUnwrap()).not.toBeNull();
  });
});
