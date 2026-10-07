/**
 * 予約の内容の変更（UC-005 / UC-017）とステータスの変更の更新文を、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Repository を偽物に差し替えるので、更新文の条件の誤りは素通りする。
 * ここでは「読んだときから変わっていないこと」（楽観的ロック）と、
 * 「変更後の時間帯に承認済みの予約が無いこと」（COND-001）の条件を実際の DB で押さえる。
 *
 * 後者は、UPDATE の WHERE が**更新前**の行を読むことに気づかないと取り違える。
 * 更新される行の列と突き合わせると、動かす前の時間帯を確かめてしまい、
 * 動かした先に承認済みの予約があっても通ってしまう。
 *
 * D1 の起動とマイグレーションは `useD1TestDb` が行う（`app/infra/d1-test-db.ts`）。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  ReservationStatus,
  type ApplyContentEditArgs,
  type ApplyStatusTransitionArgs,
  type Reservation,
} from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { createReservationRepository } from "./reservation-repo";

const testDb = useD1TestDb();

/** 予約を読んだときの更新日時 */
const READ_AT = new Date("2026-09-19T09:00:00+09:00");
/** 変更を書き込む日時 */
const EDITED_AT = new Date("2026-09-20T10:00:00+09:00");

/** 2026-09-25（日本時間）の指定した時刻 */
const at = (time: string) => new Date(`2026-09-25T${time}:00+09:00`);

const insertFacilitySql = `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`;

/** どのテストでも使う、予約者・団体・施設を入れる */
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
    [insertFacilitySql, "fac_a", "会議室 A", 1, 0, 0],
    [insertFacilitySql, "fac_b", "会議室 B", 1, 0, 0],
  );
});

interface ReservationRow {
  readonly id: string;
  readonly facilityId?: string;
  readonly status: ReservationStatus;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount?: number;
  readonly updatedAt?: Date;
}

const insertReservation = (row: ReservationRow) =>
  testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    row.id,
    "grp_robotics",
    row.facilityId ?? "fac_a",
    row.startAt.getTime(),
    row.endAt.getTime(),
    row.headCount ?? 4,
    row.status,
    "usr_taro",
    0,
    (row.updatedAt ?? READ_AT).getTime(),
  ]);

/** 書かれた行を、列の生の値のまま読み戻す。無ければ null */
const rowOf = (id: string) =>
  testDb.d1
    .prepare(
      `SELECT facility_id, start_at, end_at, head_count, note, status, updated_at FROM "reservation" WHERE id = ?`,
    )
    .bind(id)
    .first();

/** 10:00〜12:00 の予約を、読んだときの値のまま変える引数。テストごとに上書きする */
const editArgs = (overrides: Partial<ApplyContentEditArgs>): ApplyContentEditArgs => ({
  id: "res_target",
  expectedStatus: ReservationStatus.Provisional,
  expectedUpdatedAt: READ_AT,
  facilityId: "fac_a",
  startAt: at("10:00"),
  endAt: at("12:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Provisional,
  updatedAt: EDITED_AT,
  requireNoApprovedOverlap: false,
  ...overrides,
});

describe("applyContentEdit を SQLite で実行する", () => {
  describe("読んだときから変わっていないこと（楽観的ロック）", () => {
    it("読んだときのままなら、内容・ステータス・更新日時をすべて書き換える", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Approved,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });

      const result = await repository.applyContentEdit(
        editArgs({
          expectedStatus: ReservationStatus.Approved,
          facilityId: "fac_b",
          startAt: at("13:00"),
          endAt: at("15:30"),
          headCount: 8,
          note: "機材あり",
          status: ReservationStatus.Provisional,
        }),
        [],
      );

      expect(result._unsafeUnwrap()).toEqual({ applied: true, enqueuedMailIds: [] });
      expect(await rowOf("res_target")).toEqual({
        facility_id: "fac_b",
        start_at: at("13:00").getTime(),
        end_at: at("15:30").getTime(),
        head_count: 8,
        note: "機材あり",
        status: ReservationStatus.Provisional,
        updated_at: EDITED_AT.getTime(),
      });
    });

    /*
     * 退行テスト。ステータスを条件に入れていなかった時期は、読んでから書くまでに
     * 事務局が却下した予約を、読んだときのステータス（仮予約）で書き戻していた。
     */
    it("読んだ後にステータスが変わっていたら（却下された等）、1 件も書き換えない", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Rejected,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });

      const result = await repository.applyContentEdit(editArgs({ headCount: 8 }), []);

      expect(result._unsafeUnwrap().applied).toBe(false);
      expect(await rowOf("res_target")).toMatchObject({
        status: ReservationStatus.Rejected,
        head_count: 4,
      });
    });

    it("読んだ後に別の変更が入っていたら（更新日時が違えば）、1 件も書き換えない", async () => {
      const repository = createReservationRepository(testDb.db);
      // 誰かが先に使用人数を 6 にした。ステータスは仮予約のまま変わっていない
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Provisional,
        startAt: at("10:00"),
        endAt: at("12:00"),
        headCount: 6,
        updatedAt: new Date("2026-09-20T09:30:00+09:00"),
      });

      const result = await repository.applyContentEdit(editArgs({ note: "備考を追記" }), []);

      expect(result._unsafeUnwrap().applied).toBe(false);
      expect(await rowOf("res_target")).toMatchObject({ head_count: 6, note: null });
    });
  });

  describe("変更後の時間帯に承認済みの予約が無いこと（COND-001）", () => {
    it("変更後の時間帯に承認済みの予約があれば、1 件も書き換えない", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Provisional,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });
      await insertReservation({
        id: "res_other",
        status: ReservationStatus.Approved,
        startAt: at("14:00"),
        endAt: at("16:00"),
      });

      const result = await repository.applyContentEdit(
        editArgs({ startAt: at("15:00"), endAt: at("17:00"), requireNoApprovedOverlap: true }),
        [],
      );

      expect(result._unsafeUnwrap().applied).toBe(false);
      expect(await rowOf("res_target")).toMatchObject({ start_at: at("10:00").getTime() });
    });

    /*
     * 退行テスト。更新される行の列と突き合わせていた時期は、動かす前の時間帯を確かめていたので、
     * 承認済みの予約と重なっていた仮予約は、空いている時間帯へ動かすことすらできなかった。
     */
    it("動かす前の時間帯にだけ承認済みの予約があるなら、空いている時間帯へ動かせる", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Provisional,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });
      await insertReservation({
        id: "res_other",
        status: ReservationStatus.Approved,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });

      const result = await repository.applyContentEdit(
        editArgs({ startAt: at("14:00"), endAt: at("16:00"), requireNoApprovedOverlap: true }),
        [],
      );

      expect(result._unsafeUnwrap().applied).toBe(true);
    });

    it("承認済みの予約を少しずらすとき、動かす前の自分自身とは重なりと見なさない", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Approved,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });

      const result = await repository.applyContentEdit(
        editArgs({
          expectedStatus: ReservationStatus.Approved,
          startAt: at("11:00"),
          endAt: at("13:00"),
          status: ReservationStatus.Provisional,
          requireNoApprovedOverlap: true,
        }),
        [],
      );

      expect(result._unsafeUnwrap().applied).toBe(true);
    });

    it.each([
      ["別の施設の承認済み予約", { facilityId: "fac_b", status: ReservationStatus.Approved }],
      ["同じ時間帯の仮予約", { status: ReservationStatus.Provisional }],
      ["同じ時間帯の却下済み予約", { status: ReservationStatus.Rejected }],
    ] as const)("%s とは重なっていても書き換える", async (_name, other) => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Provisional,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });
      await insertReservation({
        id: "res_other",
        startAt: at("14:00"),
        endAt: at("16:00"),
        ...other,
      });

      const result = await repository.applyContentEdit(
        editArgs({ startAt: at("14:00"), endAt: at("16:00"), requireNoApprovedOverlap: true }),
        [],
      );

      expect(result._unsafeUnwrap().applied).toBe(true);
    });

    it("終了時刻ちょうどに始まる承認済み予約とは重ならない", async () => {
      const repository = createReservationRepository(testDb.db);
      await insertReservation({
        id: "res_target",
        status: ReservationStatus.Provisional,
        startAt: at("10:00"),
        endAt: at("12:00"),
      });
      await insertReservation({
        id: "res_other",
        status: ReservationStatus.Approved,
        startAt: at("15:00"),
        endAt: at("16:00"),
      });

      const result = await repository.applyContentEdit(
        editArgs({ startAt: at("13:00"), endAt: at("15:00"), requireNoApprovedOverlap: true }),
        [],
      );

      expect(result._unsafeUnwrap().applied).toBe(true);
    });
  });
});

describe("applyStatusTransition を SQLite で実行する", () => {
  /** 10:00〜12:00 の仮予約を、読んだときの値のまま承認する引数 */
  const approveArgs: ApplyStatusTransitionArgs = {
    id: "res_target",
    expectedStatus: ReservationStatus.Provisional,
    expectedUpdatedAt: READ_AT,
    status: ReservationStatus.Approved,
    statusReason: null,
    updatedAt: EDITED_AT,
    requireNoApprovedOverlap: true,
  };

  it("読んだときのままなら、承認する", async () => {
    const repository = createReservationRepository(testDb.db);
    await insertReservation({
      id: "res_target",
      status: ReservationStatus.Provisional,
      startAt: at("10:00"),
      endAt: at("12:00"),
    });

    const result = await repository.applyStatusTransition(approveArgs, []);

    expect(result._unsafeUnwrap().applied).toBe(true);
    expect(await rowOf("res_target")).toMatchObject({
      status: ReservationStatus.Approved,
      updated_at: EDITED_AT.getTime(),
    });
  });

  /*
   * 退行テスト。ステータスだけを条件にしていた時期は、事務局が読んだ後に団体のメンバーが
   * 仮予約の日時を変えても（仮予約のままなので）承認が通り、事務局が見ていない日時の予約が承認されていた。
   */
  it("読んだ後に内容が変わっていたら（ステータスが同じでも）、承認しない", async () => {
    const repository = createReservationRepository(testDb.db);
    // 事務局が読んだ後に、団体のメンバーが 14:00〜16:00 に変えた。仮予約のまま
    await insertReservation({
      id: "res_target",
      status: ReservationStatus.Provisional,
      startAt: at("14:00"),
      endAt: at("16:00"),
      updatedAt: new Date("2026-09-20T09:30:00+09:00"),
    });

    const result = await repository.applyStatusTransition(approveArgs, []);

    expect(result._unsafeUnwrap().applied).toBe(false);
    expect(await rowOf("res_target")).toMatchObject({ status: ReservationStatus.Provisional });
  });
});

describe("existsApprovedOverlap を SQLite で実行する", () => {
  it("excludeReservationId に渡した予約は、重なりの相手に数えない", async () => {
    const repository = createReservationRepository(testDb.db);
    await insertReservation({
      id: "res_target",
      status: ReservationStatus.Approved,
      startAt: at("10:00"),
      endAt: at("12:00"),
    });
    const slot = { facilityId: "fac_a", startAt: at("11:00"), endAt: at("13:00") };

    expect((await repository.existsApprovedOverlap(slot))._unsafeUnwrap()).toBe(true);
    expect(
      (
        await repository.existsApprovedOverlap({ ...slot, excludeReservationId: "res_target" })
      )._unsafeUnwrap(),
    ).toBe(false);
  });
});

describe("createApproved を SQLite で実行する", () => {
  const directReservation = (overrides?: Partial<Reservation>): Reservation => ({
    id: "res_direct",
    groupId: "grp_robotics",
    facilityId: "fac_a",
    startAt: at("10:00"),
    endAt: at("12:00"),
    headCount: 4,
    note: "直接作成のテスト",
    status: ReservationStatus.Approved,
    statusReason: null,
    createdBy: "usr_taro",
    createdAt: at("09:00"),
    updatedAt: at("09:00"),
    ...overrides,
  });

  /*
   * INSERT ... SELECT は列を名前ではなく並び順で対応させるので、読み戻した予約が
   * 渡したものと全項目で一致することまで確かめる。一部の列だけ見ると、
   * 作成日時と更新日時の入れ違いのような取り違えを見逃す。
   */
  it("(1) 重なりが無ければ承認済みで入り、読み戻すと同じ予約になる", async () => {
    const repository = createReservationRepository(testDb.db);

    const result = await repository.createApproved(directReservation());

    expect(result._unsafeUnwrap()).toEqual({ applied: true });
    expect((await repository.findById("res_direct"))._unsafeUnwrap()).toEqual(directReservation());
  });

  it("(2) 承認済みと重なれば何も入らない", async () => {
    const repository = createReservationRepository(testDb.db);
    await insertReservation({
      id: "res_existing",
      status: ReservationStatus.Approved,
      startAt: at("11:00"),
      endAt: at("13:00"),
    });

    const result = await repository.createApproved(directReservation());

    expect(result._unsafeUnwrap()).toEqual({ applied: false });
    expect(await rowOf("res_direct")).toBeNull();
  });

  it("(3) 終了と開始がぴったり接するだけなら作れる", async () => {
    const repository = createReservationRepository(testDb.db);
    // 8:00〜10:00 と 12:00〜14:00 の前後に承認済みがある
    await insertReservation({
      id: "res_before",
      status: ReservationStatus.Approved,
      startAt: at("08:00"),
      endAt: at("10:00"),
    });
    await insertReservation({
      id: "res_after",
      status: ReservationStatus.Approved,
      startAt: at("12:00"),
      endAt: at("14:00"),
    });

    const result = await repository.createApproved(directReservation());

    expect(result._unsafeUnwrap()).toEqual({ applied: true });
    expect(await rowOf("res_direct")).toMatchObject({
      status: ReservationStatus.Approved,
    });
  });

  it("(4) 仮予約と重なっても作れる", async () => {
    const repository = createReservationRepository(testDb.db);
    await insertReservation({
      id: "res_provisional",
      status: ReservationStatus.Provisional,
      startAt: at("10:00"),
      endAt: at("12:00"),
    });

    const result = await repository.createApproved(directReservation());

    expect(result._unsafeUnwrap()).toEqual({ applied: true });
    expect(await rowOf("res_direct")).toMatchObject({
      status: ReservationStatus.Approved,
    });
  });
});
