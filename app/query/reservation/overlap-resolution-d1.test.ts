/**
 * 重なりの解決（findOverlapResolution）をローカル D1 に対して検証するテスト。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findOverlapResolution } from "./overlap-resolution";

const testDb = useD1TestDb();

const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_APPLICANT.id, name: USER_APPLICANT.name, email: USER_APPLICANT.email }),
    seedGroup({ id: "grp_test", name: "テスト団体" }),
    seedFacility({ id: "fac_1", name: "会議室 1" }),
    seedFacility({ id: "fac_2", name: "会議室 2" }),
  );
});

async function insertReservation({
  id,
  facilityId = "fac_1",
  startAt,
  endAt,
  requestedAt = new Date("2026-10-01T10:00:00+09:00"),
  status = ReservationStatus.Provisional,
  note = null,
  headCount = 2,
}: {
  id: string;
  facilityId?: string;
  startAt: Date;
  endAt: Date;
  requestedAt?: Date;
  status?: ReservationStatus;
  note?: string | null;
  headCount?: number;
}) {
  await testDb.seed(
    seedReservation({
      id,
      groupId: "grp_test",
      facilityId,
      startAt,
      endAt,
      requestedAt,
      headCount,
      note,
      status,
      createdBy: USER_APPLICANT.id,
    }),
  );
}

describe("findOverlapResolution", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findOverlapResolution(testDb.db, {
      isStaff: false,
      reservationId: "res_any",
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("存在しない予約 ID を指定すると NotFound を返す", async () => {
    const result = await findOverlapResolution(testDb.db, {
      isStaff: true,
      reservationId: "res_not_found",
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });

  it("10〜12・11〜13・12〜14 の仮予約が申請日時の古い順に返り、対象外の予約は入らない", async () => {
    // まとまりとなる 3 件（申請日時の順序をずらして投入）
    await insertReservation({
      id: "res_3",
      startAt: new Date("2026-10-15T12:00:00+09:00"),
      endAt: new Date("2026-10-15T14:00:00+09:00"),
      requestedAt: new Date("2026-10-03T10:00:00+09:00"),
      note: "3件目の備考",
    });
    await insertReservation({
      id: "res_1",
      startAt: new Date("2026-10-15T10:00:00+09:00"),
      endAt: new Date("2026-10-15T12:00:00+09:00"),
      requestedAt: new Date("2026-10-01T10:00:00+09:00"),
      note: "1件目の備考",
    });
    await insertReservation({
      id: "res_2",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
      requestedAt: new Date("2026-10-02T10:00:00+09:00"),
    });

    // 次のものは入らない:
    // 1. 同じ施設の別の日の仮予約
    await insertReservation({
      id: "res_other_day",
      startAt: new Date("2026-10-16T11:00:00+09:00"),
      endAt: new Date("2026-10-16T13:00:00+09:00"),
    });
    // 2. 別の施設の同じ時間帯の仮予約
    await insertReservation({
      id: "res_other_fac",
      facilityId: "fac_2",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
    });
    // 3. 同じ時間帯の取り消し済みの予約
    await insertReservation({
      id: "res_withdrawn",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
      status: ReservationStatus.Withdrawn,
    });
    // 4. 同じ時間帯の却下済みの予約
    await insertReservation({
      id: "res_rejected",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
      status: ReservationStatus.Rejected,
    });
    // 5. まとまりとつながらない同じ日の仮予約
    await insertReservation({
      id: "res_disjoint",
      startAt: new Date("2026-10-15T16:00:00+09:00"),
      endAt: new Date("2026-10-15T18:00:00+09:00"),
    });

    const result = await findOverlapResolution(testDb.db, {
      isStaff: true,
      reservationId: "res_1",
    });

    const value = result._unsafeUnwrap();
    expect(value.candidates.map((c) => c.id)).toEqual(["res_1", "res_2", "res_3"]);
    expect(value.candidates[0]?.facilityName).toBe("会議室 1");
    expect(value.candidates[0]?.groupName).toBe("テスト団体");
    expect(value.candidates[0]?.note).toBe("1件目の備考");
    expect(value.candidates[2]?.note).toBe("3件目の備考");
  });

  it("承認済みの予約と重なる仮予約は hasApprovedOverlap が true になる", async () => {
    // 承認済みの予約（10:00〜11:00）
    await insertReservation({
      id: "res_approved",
      startAt: new Date("2026-10-15T10:00:00+09:00"),
      endAt: new Date("2026-10-15T11:00:00+09:00"),
      status: ReservationStatus.Approved,
    });
    // 承認済みと重なる仮予約（10:30〜12:00）
    await insertReservation({
      id: "res_overlap_app",
      startAt: new Date("2026-10-15T10:30:00+09:00"),
      endAt: new Date("2026-10-15T12:00:00+09:00"),
    });
    // 承認済みと重ならない仮予約（11:00〜12:30。終了と開始が同じ時刻なので重ならない）
    await insertReservation({
      id: "res_no_overlap_app",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T12:30:00+09:00"),
    });

    const result = await findOverlapResolution(testDb.db, {
      isStaff: true,
      reservationId: "res_overlap_app",
    });

    const value = result._unsafeUnwrap();
    const candidateMap = new Map(value.candidates.map((c) => [c.id, c.hasApprovedOverlap]));
    expect(candidateMap.get("res_overlap_app")).toBe(true);
    expect(candidateMap.get("res_no_overlap_app")).toBe(false);
  });

  it("開いた予約が承認済みなら空の配列を返す", async () => {
    await insertReservation({
      id: "res_approved_target",
      startAt: new Date("2026-10-15T10:00:00+09:00"),
      endAt: new Date("2026-10-15T12:00:00+09:00"),
      status: ReservationStatus.Approved,
    });
    // 重なる仮予約が存在しても、開いた予約自身が仮予約でないので空になる
    await insertReservation({
      id: "res_provisional_other",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
    });

    const result = await findOverlapResolution(testDb.db, {
      isStaff: true,
      reservationId: "res_approved_target",
    });

    expect(result._unsafeUnwrap().candidates).toEqual([]);
  });

  it("重なる相手の無い仮予約は、その 1 件だけのまとまりを返す", async () => {
    await insertReservation({
      id: "res_alone",
      startAt: new Date("2026-10-15T10:00:00+09:00"),
      endAt: new Date("2026-10-15T12:00:00+09:00"),
    });

    const result = await findOverlapResolution(testDb.db, {
      isStaff: true,
      reservationId: "res_alone",
    });

    const value = result._unsafeUnwrap();
    expect(value.candidates.map((c) => c.id)).toEqual(["res_alone"]);
    expect(value.candidates[0]?.hasApprovedOverlap).toBe(false);
  });
});
