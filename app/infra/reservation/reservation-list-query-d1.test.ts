import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { seedFacility, seedGroup, seedReservation, seedUser } from "../d1-test-seeds";
import { createReservationListQuery } from "./reservation-list-query";

const testDb = useD1TestDb();

/** 2026-10-01（日本時間）の指定した時刻 */
const at = (time: string) => new Date(`2026-10-01T${time}:00+09:00`);

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_taro", name: "太郎", email: "taro@ecs.osaka-u.ac.jp" }),
    seedGroup({ id: "grp_robotics", name: "ロボット部" }),
    seedGroup({ id: "grp_ai", name: "AI 研究会" }),
    seedFacility({ id: "fac_a", name: "会議室 A" }),
  );
});

describe("findList の並び順（requested_at_asc）", () => {
  it("作成日時ではなく申請日時の古い順に並べ、申請日時と申請者名を返す", async () => {
    /*
     * res_moved は先に作ったが、あとから時間帯を動かして申し込み直した（申請日時が新しい）。
     * 作成日時の順に並べると、同じ時間帯に先に申し込んだ res_waiting より前に来てしまう。
     */
    await testDb.seed(
      seedReservation({
        id: "res_moved",
        groupId: "grp_ai",
        facilityId: "fac_a",
        startAt: new Date("2026-10-10T10:00:00+09:00"),
        endAt: new Date("2026-10-10T12:00:00+09:00"),
        status: ReservationStatus.Provisional,
        createdBy: "usr_taro",
        createdAt: at("09:00"),
        requestedAt: at("11:00"),
      }),
      seedReservation({
        id: "res_waiting",
        groupId: "grp_robotics",
        facilityId: "fac_a",
        startAt: new Date("2026-10-10T10:00:00+09:00"),
        endAt: new Date("2026-10-10T12:00:00+09:00"),
        status: ReservationStatus.Provisional,
        createdBy: "usr_taro",
        createdAt: at("10:00"),
      }),
    );

    const rows = (
      await createReservationListQuery(testDb.db).findList({
        groupIds: null,
        statuses: [ReservationStatus.Provisional],
        facilityId: null,
        from: null,
        to: null,
        sort: "requested_at_asc",
      })
    )._unsafeUnwrap();

    expect(rows.map((row) => [row.id, row.requestedAt])).toEqual([
      ["res_waiting", at("10:00")],
      ["res_moved", at("11:00")],
    ]);
    expect(rows[0]?.createdByName).toBe("太郎");
  });

  it("申請日時が同じなら、予約 ID の順に並べる（読み込み直すたびに入れ替わらない）", async () => {
    await testDb.seed(
      ...["res_b", "res_a"].map((id) =>
        seedReservation({
          id,
          groupId: "grp_robotics",
          facilityId: "fac_a",
          startAt: new Date("2026-10-10T10:00:00+09:00"),
          endAt: new Date("2026-10-10T12:00:00+09:00"),
          status: ReservationStatus.Provisional,
          createdBy: "usr_taro",
          createdAt: at("10:00"),
        }),
      ),
    );

    const rows = (
      await createReservationListQuery(testDb.db).findList({
        groupIds: null,
        statuses: [ReservationStatus.Provisional],
        facilityId: null,
        from: null,
        to: null,
        sort: "requested_at_asc",
      })
    )._unsafeUnwrap();

    expect(rows.map((row) => row.id)).toEqual(["res_a", "res_b"]);
  });
});
