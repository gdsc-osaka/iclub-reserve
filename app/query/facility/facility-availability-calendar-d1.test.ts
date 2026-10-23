/**
 * 空き状況カレンダー（findFacilityAvailabilityCalendar）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す（ADR-013）
 * - 表示する施設の選び方（指定なしは先頭・無効な施設や無い施設は NotFound）
 * - 期間と重なる承認済み・仮予約だけを、どの団体の分も全項目で返す
 * - 事務局が実行できる操作と、承認済みの予約との重なりを添える
 * - 期間内の祝日を返す
 */
import { beforeEach, describe, expect, it } from "vitest";

import { holidayTable } from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findFacilityAvailabilityCalendar } from "./facility-availability-calendar";

const testDb = useD1TestDb();

const USER_ID = "usr_applicant";

// 2026-10-18（日）0 時から 1 週間
const FROM = new Date("2026-10-18T00:00:00+09:00");
const TO = new Date("2026-10-25T00:00:00+09:00");

const staffArgs = { isStaff: true, facilityId: "fac_a", from: FROM, to: TO } as const;

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_ID, name: "申請者", email: "applicant@example.com" }),
    seedGroup({ id: "grp_robot", name: "ロボット部" }),
    seedGroup({ id: "grp_drone", name: "ドローン部" }),
    // 名前の順に並ぶので、指定が無いときの先頭は「A 会議室」
    seedFacility({ id: "fac_b", name: "B 工作室", isActive: true }),
    seedFacility({ id: "fac_a", name: "A 会議室", isActive: true }),
    seedFacility({ id: "fac_inactive", name: "0 使えない部屋", isActive: false }),
  );
});

async function insertReservation(
  id: string,
  options: {
    readonly groupId?: string;
    readonly facilityId?: string;
    readonly startAt: string;
    readonly endAt: string;
    readonly status?: ReservationStatus;
    readonly headCount?: number;
    readonly note?: string | null;
  },
) {
  await testDb.seed(
    seedReservation({
      id,
      groupId: options.groupId ?? "grp_robot",
      facilityId: options.facilityId ?? "fac_a",
      startAt: new Date(options.startAt),
      endAt: new Date(options.endAt),
      status: options.status ?? ReservationStatus.Provisional,
      headCount: options.headCount ?? 1,
      note: options.note ?? null,
      createdBy: USER_ID,
    }),
  );
}

describe("findFacilityAvailabilityCalendar", () => {
  it("事務局でない人には Forbidden を返す（ADR-013）", async () => {
    const result = await findFacilityAvailabilityCalendar(testDb.db, {
      ...staffArgs,
      isStaff: false,
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("施設を指定しないときは、有効な施設のうち名前の順で先頭の施設を返す", async () => {
    const result = await findFacilityAvailabilityCalendar(testDb.db, {
      ...staffArgs,
      facilityId: null,
    });

    const calendar = result._unsafeUnwrap();
    expect(calendar.facility.id).toBe("fac_a");
    // 無効な施設は切り替えにも出さない
    expect(calendar.facilities.map((facility) => facility.id)).toEqual(["fac_a", "fac_b"]);
  });

  it("無効な施設や、無い施設を指定されたら NotFound を返す", async () => {
    const inactive = await findFacilityAvailabilityCalendar(testDb.db, {
      ...staffArgs,
      facilityId: "fac_inactive",
    });
    const missing = await findFacilityAvailabilityCalendar(testDb.db, {
      ...staffArgs,
      facilityId: "fac_missing",
    });

    expect(inactive._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
    expect(missing._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });

  it("期間と重なる、その施設の承認済み・仮予約だけを開始日時の順に返す", async () => {
    // 前の週から続いている予約は、期間の始まりと重なるので含める
    await insertReservation("res_from_last_week", {
      startAt: "2026-10-17T20:00:00+09:00",
      endAt: "2026-10-18T10:00:00+09:00",
      status: ReservationStatus.Approved,
    });
    await insertReservation("res_wednesday", {
      startAt: "2026-10-21T10:00:00+09:00",
      endAt: "2026-10-21T12:00:00+09:00",
    });
    // 期間の終わり（次の日曜 0 時）ちょうどに始まる予約は含めない
    await insertReservation("res_next_week", {
      startAt: "2026-10-25T00:00:00+09:00",
      endAt: "2026-10-25T10:00:00+09:00",
    });
    // 別の施設の予約は含めない
    await insertReservation("res_other_facility", {
      facilityId: "fac_b",
      startAt: "2026-10-21T10:00:00+09:00",
      endAt: "2026-10-21T12:00:00+09:00",
    });
    // 終わった予約（取り消し・キャンセル）は描かない
    await insertReservation("res_withdrawn", {
      startAt: "2026-10-22T10:00:00+09:00",
      endAt: "2026-10-22T12:00:00+09:00",
      status: ReservationStatus.Withdrawn,
    });
    await insertReservation("res_cancelled", {
      startAt: "2026-10-22T13:00:00+09:00",
      endAt: "2026-10-22T14:00:00+09:00",
      status: ReservationStatus.Cancelled,
    });

    const result = await findFacilityAvailabilityCalendar(testDb.db, staffArgs);

    expect(result._unsafeUnwrap().reservations.map((reservation) => reservation.id)).toEqual([
      "res_from_last_week",
      "res_wednesday",
    ]);
  });

  it("どの団体の予約も、使用人数と備考まで返す（COND-009）", async () => {
    await insertReservation("res_robot", {
      groupId: "grp_robot",
      startAt: "2026-10-21T10:00:00+09:00",
      endAt: "2026-10-21T12:00:00+09:00",
      headCount: 4,
      note: "ロボット部の備考",
    });
    await insertReservation("res_drone", {
      groupId: "grp_drone",
      startAt: "2026-10-22T10:00:00+09:00",
      endAt: "2026-10-22T12:00:00+09:00",
      status: ReservationStatus.Approved,
      headCount: 7,
      note: "ドローン部の備考",
    });

    const result = await findFacilityAvailabilityCalendar(testDb.db, staffArgs);

    expect(result._unsafeUnwrap().reservations).toEqual([
      expect.objectContaining({
        id: "res_robot",
        groupName: "ロボット部",
        headCount: 4,
        note: "ロボット部の備考",
      }),
      expect.objectContaining({
        id: "res_drone",
        groupName: "ドローン部",
        headCount: 7,
        note: "ドローン部の備考",
      }),
    ]);
  });

  it("事務局が実行できる操作と、承認済みの予約との重なりを添える", async () => {
    await insertReservation("res_approved", {
      groupId: "grp_drone",
      startAt: "2026-10-21T10:00:00+09:00",
      endAt: "2026-10-21T12:00:00+09:00",
      status: ReservationStatus.Approved,
    });
    // 承認済みの予約と時間帯が重なる仮予約（COND-001。承認できない）
    await insertReservation("res_overlapping", {
      startAt: "2026-10-21T11:00:00+09:00",
      endAt: "2026-10-21T13:00:00+09:00",
    });
    await insertReservation("res_free", {
      startAt: "2026-10-22T10:00:00+09:00",
      endAt: "2026-10-22T12:00:00+09:00",
    });

    const result = await findFacilityAvailabilityCalendar(testDb.db, staffArgs);
    const byId = new Map(
      result._unsafeUnwrap().reservations.map((reservation) => [reservation.id, reservation]),
    );

    // 承認済みの予約には事務局キャンセルだけ、仮予約には承認と却下を出す。団体側の操作は出さない
    expect(byId.get("res_approved")?.transitions).toEqual([ReservationTransition.StaffCancel]);
    expect(byId.get("res_free")?.transitions).toEqual([
      ReservationTransition.Approve,
      ReservationTransition.Reject,
    ]);
    expect(byId.get("res_overlapping")?.hasApprovedOverlap).toBe(true);
    expect(byId.get("res_free")?.hasApprovedOverlap).toBe(false);
  });

  it("期間内の祝日だけを返す", async () => {
    await testDb.db.insert(holidayTable).values([
      { date: "2026-10-17", name: "期間の前日" },
      { date: "2026-10-20", name: "期間内の祝日" },
      // 期間の終わり（10-25 の 0 時）は含まないので、末日は 10-24
      { date: "2026-10-24", name: "期間の末日" },
      { date: "2026-10-25", name: "期間の翌日" },
    ]);

    const result = await findFacilityAvailabilityCalendar(testDb.db, staffArgs);

    expect(result._unsafeUnwrap().holidayDateKeys).toEqual(["2026-10-20", "2026-10-24"]);
  });
});
