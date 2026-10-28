/**
 * 解錠の手配が要る予約（findStaffUnlockRequiredReservations）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - 承認済み・終了日時が今より後・手配が要る（Required）予約だけを返す
 * - 手配済み・不要・未定・承認済みでない・終了した予約（endAt <= now）は含めない
 * - 開始が近い順に最大 5 件返し、総数は 5 件を超えた分も数える
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus, UnlockArrangement } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findStaffUnlockRequiredReservations } from "./staff-unlock-required-reservations";

const testDb = useD1TestDb();

const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };
const NOW = new Date("2026-10-15T12:00:00+09:00");

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_APPLICANT.id, name: USER_APPLICANT.name, email: USER_APPLICANT.email }),
    seedGroup({ id: "grp_test", name: "テスト団体" }),
    seedFacility({ id: "fac_1", name: "会議室 1" }),
  );
});

async function insertReservation(opts: {
  id: string;
  startAt: Date;
  endAt: Date;
  status?: ReservationStatus;
  unlockArrangement?: UnlockArrangement | null;
}) {
  await testDb.seed(
    seedReservation({
      id: opts.id,
      groupId: "grp_test",
      facilityId: "fac_1",
      startAt: opts.startAt,
      endAt: opts.endAt,
      headCount: 2,
      status: opts.status ?? ReservationStatus.Approved,
      unlockArrangement:
        opts.unlockArrangement === undefined ? UnlockArrangement.Required : opts.unlockArrangement,
      createdBy: USER_APPLICANT.id,
    }),
  );
}

describe("findStaffUnlockRequiredReservations", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findStaffUnlockRequiredReservations(testDb.db, {
      isStaff: false,
      now: NOW,
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("承認済み・終了日時が今より後・手配が要る（Required）予約だけが含まれ、手配済み・不要・未定・未承認・終了後は入らない", async () => {
    // 1. 開始済みだが終了前の承認済み・手配が要る予約（入る）
    await insertReservation({
      id: "res_ongoing_required",
      startAt: new Date("2026-10-15T11:00:00+09:00"),
      endAt: new Date("2026-10-15T13:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.Required,
    });

    // 2. 未来の承認済み・手配が要る予約（入る）
    await insertReservation({
      id: "res_future_required",
      startAt: new Date("2026-10-16T10:00:00+09:00"),
      endAt: new Date("2026-10-16T12:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.Required,
    });

    // 3. 手配済み（入らない）
    await insertReservation({
      id: "res_arranged",
      startAt: new Date("2026-10-16T13:00:00+09:00"),
      endAt: new Date("2026-10-16T15:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.Arranged,
    });

    // 4. 不要（入らない）
    await insertReservation({
      id: "res_not_required",
      startAt: new Date("2026-10-16T15:00:00+09:00"),
      endAt: new Date("2026-10-16T17:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.NotRequired,
    });

    // 5. 未定（null）（入らない）
    await insertReservation({
      id: "res_undecided",
      startAt: new Date("2026-10-17T10:00:00+09:00"),
      endAt: new Date("2026-10-17T12:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: null,
    });

    // 6. 仮予約（入らない）
    await insertReservation({
      id: "res_provisional",
      startAt: new Date("2026-10-17T13:00:00+09:00"),
      endAt: new Date("2026-10-17T15:00:00+09:00"),
      status: ReservationStatus.Provisional,
      unlockArrangement: UnlockArrangement.Required,
    });

    // 7. キャンセル済み（入らない）
    await insertReservation({
      id: "res_cancelled",
      startAt: new Date("2026-10-17T15:00:00+09:00"),
      endAt: new Date("2026-10-17T17:00:00+09:00"),
      status: ReservationStatus.Cancelled,
      unlockArrangement: UnlockArrangement.Required,
    });

    // 8. ちょうど今に終了した予約（endAt === NOW）（入らない）
    await insertReservation({
      id: "res_ended_now",
      startAt: new Date("2026-10-15T10:00:00+09:00"),
      endAt: NOW,
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.Required,
    });

    // 9. 今より前に終了した予約（endAt < NOW）（入らない）
    await insertReservation({
      id: "res_ended_past",
      startAt: new Date("2026-10-15T09:00:00+09:00"),
      endAt: new Date("2026-10-15T11:00:00+09:00"),
      status: ReservationStatus.Approved,
      unlockArrangement: UnlockArrangement.Required,
    });

    const result = await findStaffUnlockRequiredReservations(testDb.db, {
      isStaff: true,
      now: NOW,
    });

    const value = result._unsafeUnwrap();
    expect(value.items.map((item) => item.id)).toEqual([
      "res_ongoing_required",
      "res_future_required",
    ]);
    expect(value.totalCount).toBe(2);
    expect(value.items[0]).toMatchObject({
      id: "res_ongoing_required",
      groupName: "テスト団体",
      facilityName: "会議室 1",
    });
  });

  it("開始日時の昇順で最大 5 件返し、総数は 5 件を超えた分も数える", async () => {
    for (const [id, day] of [
      ["res_3", "18"],
      ["res_1", "16"],
      ["res_5", "20"],
      ["res_2", "17"],
      ["res_6", "21"],
      ["res_4", "19"],
    ] as const) {
      await insertReservation({
        id,
        startAt: new Date(`2026-10-${day}T10:00:00+09:00`),
        endAt: new Date(`2026-10-${day}T12:00:00+09:00`),
      });
    }

    const result = await findStaffUnlockRequiredReservations(testDb.db, {
      isStaff: true,
      now: NOW,
    });

    const value = result._unsafeUnwrap();
    expect(value.items.map((item) => item.id)).toEqual([
      "res_1",
      "res_2",
      "res_3",
      "res_4",
      "res_5",
    ]);
    expect(value.totalCount).toBe(6);
  });
});
