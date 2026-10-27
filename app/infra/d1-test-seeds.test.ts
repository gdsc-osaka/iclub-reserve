import { describe, expect, it } from "vite-plus/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { GroupStatus } from "~/domain/group";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "./d1-test-db";
import { seedAuditLog, seedFacility, seedGroup, seedReservation, seedUser } from "./d1-test-seeds";

const testDb = useD1TestDb();

/** 入った行を、D1 に保存された生の値のまま読む */
const rawRow = (table: string, id: string) =>
  testDb.d1.prepare(`SELECT * FROM "${table}" WHERE id = ?`).bind(id).first();

describe("d1-test-seeds", () => {
  /*
   * 組み立て関数そのものは、ほかの D1 のテストすべてが使っている。
   * ここでは、それらのテストからは見えにくい「省いた列の既定値」と「値の変換」だけを確かめる。
   */
  it("省いた列には既定値が入り、日時はミリ秒・真偽値は 0/1・変更の中身は JSON で入る", async () => {
    const startAt = new Date("2026-10-20T10:00:00.000Z");
    const endAt = new Date("2026-10-20T12:00:00.000Z");

    await testDb.seed(
      seedUser({ id: "usr_1", name: "阪大太郎", email: "taro@ecs.osaka-u.ac.jp", is_staff: true }),
      seedGroup({ id: "grp_1", name: "ロボット部" }),
      seedFacility({ id: "fac_1", name: "第1会議室" }),
      seedReservation({
        id: "res_1",
        groupId: "grp_1",
        facilityId: "fac_1",
        startAt,
        endAt,
        createdBy: "usr_1",
      }),
      seedAuditLog({
        id: "log_1",
        actorId: "usr_1",
        action: AuditLogAction.ReservationApply,
        targetId: "res_1",
        changes: { head_count: { before: null, after: 3 } },
      }),
    );

    expect(await rawRow("user", "usr_1")).toMatchObject({
      email_verified: 1,
      is_staff: 1,
      created_at: 0,
      updated_at: 0,
    });
    expect(await rawRow("group", "grp_1")).toMatchObject({ status: GroupStatus.Enabled });
    expect(await rawRow("facility", "fac_1")).toMatchObject({
      is_active: 1,
      google_calendar_id: null,
    });
    expect(await rawRow("reservation", "res_1")).toMatchObject({
      start_at: startAt.getTime(),
      end_at: endAt.getTime(),
      head_count: 1,
      status: ReservationStatus.Provisional,
    });
    expect(await rawRow("audit_log", "log_1")).toMatchObject({
      occurred_at: 0,
      acted_as_staff: 0,
      // 対象の種類は、操作の種類から決まる
      target_type: AuditLogTargetType.Reservation,
      group_id: null,
      changes: JSON.stringify({ head_count: { before: null, after: 3 } }),
    });
  });
});
