/**
 * 承認待ちの予約（findStaffPendingReservations）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - 開始日時が今より後の仮予約だけを、開始が近い順に返す
 * - 承認済みの予約・ほかの仮予約との重なりを返す
 *
 * 利用日まで 7 日を切っている数の境目は、DB の要らない `toStaffPendingReservations` のテストで確かめる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { QueryErrorCode } from "../error";
import { findStaffPendingReservations } from "./staff-pending-reservations";

const testDb = useD1TestDb();

const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };
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
      "fac_1",
      "会議室 1",
      1,
      0,
      0,
    ],
  );
});

async function insertReservation(
  id: string,
  startAt: Date,
  endAt: Date,
  status: ReservationStatus = ReservationStatus.Provisional,
) {
  await testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    "grp_test",
    "fac_1",
    startAt.getTime(),
    endAt.getTime(),
    2,
    status,
    USER_APPLICANT.id,
    0,
    0,
  ]);
}

describe("findStaffPendingReservations", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findStaffPendingReservations(testDb.db, { isStaff: false, now: NOW });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("開始日時が今より後の仮予約を開始が近い順に 5 件返し、総数は 5 件を超えた分も数える", async () => {
    // 入れる順番と開始日時の順番をわざとずらす
    for (const [id, day] of [
      ["res_3", "17"],
      ["res_1", "15"],
      ["res_5", "19"],
      ["res_2", "16"],
      ["res_6", "20"],
      ["res_4", "18"],
    ] as const) {
      await insertReservation(
        id,
        new Date(`2026-10-${day}T15:00:00+09:00`),
        new Date(`2026-10-${day}T17:00:00+09:00`),
      );
    }

    const result = await findStaffPendingReservations(testDb.db, { isStaff: true, now: NOW });

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

  it("開始日時が今以前の仮予約と、仮予約でない予約は含めない", async () => {
    // 今（12:00）より前に始まり、まだ終わっていない仮予約
    await insertReservation(
      "res_started",
      new Date("2026-10-15T11:00:00+09:00"),
      new Date("2026-10-15T13:00:00+09:00"),
    );
    // ちょうど今に始まる仮予約
    await insertReservation("res_now", NOW, new Date("2026-10-15T14:00:00+09:00"));
    await insertReservation(
      "res_approved",
      new Date("2026-10-16T10:00:00+09:00"),
      new Date("2026-10-16T11:00:00+09:00"),
      ReservationStatus.Approved,
    );
    await insertReservation(
      "res_future",
      new Date("2026-10-15T14:00:00+09:00"),
      new Date("2026-10-15T16:00:00+09:00"),
    );

    const result = await findStaffPendingReservations(testDb.db, { isStaff: true, now: NOW });

    expect(result._unsafeUnwrap().items.map((item) => item.id)).toEqual(["res_future"]);
  });

  it("同じ施設・時間帯の承認済みの予約と、ほかの仮予約との重なりを返す", async () => {
    await insertReservation(
      "res_approved",
      new Date("2026-10-16T10:00:00+09:00"),
      new Date("2026-10-16T12:00:00+09:00"),
      ReservationStatus.Approved,
    );
    // 承認済みと重なる
    await insertReservation(
      "res_over_approved",
      new Date("2026-10-16T11:00:00+09:00"),
      new Date("2026-10-16T13:00:00+09:00"),
    );
    // 仮予約どうしで重なる 2 件（承認済みの終わる 12:00 に始まるので、承認済みとは重ならない）
    await insertReservation(
      "res_pair_a",
      new Date("2026-10-17T10:00:00+09:00"),
      new Date("2026-10-17T12:00:00+09:00"),
    );
    await insertReservation(
      "res_pair_b",
      new Date("2026-10-17T11:00:00+09:00"),
      new Date("2026-10-17T12:00:00+09:00"),
    );
    // どれとも重ならない
    await insertReservation(
      "res_alone",
      new Date("2026-10-18T10:00:00+09:00"),
      new Date("2026-10-18T12:00:00+09:00"),
    );

    const result = await findStaffPendingReservations(testDb.db, { isStaff: true, now: NOW });

    const flags = Object.fromEntries(
      result
        ._unsafeUnwrap()
        .items.map((item) => [item.id, [item.hasApprovedOverlap, item.hasProvisionalOverlap]]),
    );
    expect(flags).toEqual({
      // res_over_approved は res_approved と重なり、仮予約どうしの重なりは無い
      res_over_approved: [true, false],
      res_pair_a: [false, true],
      res_pair_b: [false, true],
      res_alone: [false, false],
    });
  });
});
