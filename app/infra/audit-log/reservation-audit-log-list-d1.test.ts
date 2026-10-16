import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { seedAuditLog, seedFacility, seedGroup, seedReservation, seedUser } from "../d1-test-seeds";
import { createReservationAuditLogListQuery } from "./reservation-audit-log-list-query";

/*
 * Query は内部で `db.batch()` を使う。D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、
 * 同じ名前の列が 2 つあると 1 つに潰れて後ろの列がずれる。ここでは本物の D1 で流しているので、
 * 列名が重なる問い合わせを書けば、下の値の比較がそのまま落ちる。
 */
const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({
      id: "usr_staff",
      name: "事務局スタッフ",
      email: "staff@osaka-u.ac.jp",
      is_staff: true,
    }),
    seedUser({
      id: "usr_student_1",
      name: "阪大太郎",
      email: "taro@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedUser({
      id: "usr_student_2",
      name: "阪大花子",
      email: "hanako@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedGroup({ id: "grp_alpha", name: "アルファ部" }),
    seedFacility({ id: "fac_room_a", name: "会議室A" }),
    seedFacility({ id: "fac_room_b", name: "会議室B" }),
    seedReservation({
      id: "rsv_target",
      groupId: "grp_alpha",
      facilityId: "fac_room_a",
      startAt: new Date(1700000000000),
      endAt: new Date(1700003600000),
      headCount: 4,
      status: ReservationStatus.Provisional,
      createdBy: "usr_student_1",
    }),
    seedReservation({
      id: "rsv_other",
      groupId: "grp_alpha",
      facilityId: "fac_room_b",
      startAt: new Date(1700000000000),
      endAt: new Date(1700003600000),
      headCount: 4,
      status: ReservationStatus.Provisional,
      createdBy: "usr_student_2",
    }),
  );
});

describe("ReservationAuditLogListQuery (本物の D1 を使用したテスト)", () => {
  it("別の予約の記録と、target_id が同じでも target_type が予約でない記録は混ざらない", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);

    // 対象の予約の記録
    await testDb.seed(
      seedAuditLog({
        id: "log_target_1",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
        changes: { head_count: { before: null, after: 4 } },
      }),
      // 別の予約の記録
      seedAuditLog({
        id: "log_other_rsv",
        occurredAt: new Date(2000),
        actorId: "usr_student_2",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_other",
        groupId: "grp_alpha",
        changes: { head_count: { before: null, after: 2 } },
      }),
      // target_id が同じ文字列でも target_type が予約でない記録（例: 施設）
      seedAuditLog({
        id: "log_facility_same_id",
        occurredAt: new Date(3000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.FacilityUpdate,
        targetType: AuditLogTargetType.Facility,
        targetId: "rsv_target",
        groupId: null,
        changes: { name: { before: "旧", after: "新" } },
      }),
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("log_target_1");
  });

  it("新しい順。同じ occurred_at は id の降順", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);

    // 時刻違いと同時刻の複数レコード
    await testDb.seed(
      seedAuditLog({
        id: "log_1",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_a",
        occurredAt: new Date(2000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.ReservationApprove,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_z",
        occurredAt: new Date(2000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.ReservationChange,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_3",
        occurredAt: new Date(3000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationCancel,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
      }),
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    // occurred_at DESC, id DESC なので log_3 (3000) -> log_z (2000) -> log_a (2000) -> log_1 (1000)
    expect(list.items.map((i) => i.id)).toEqual(["log_3", "log_z", "log_a", "log_1"]);
  });

  it("21 件あると 1 ページ目は 20 件・hasNextPage: true、2 ページ目は 1 件・false", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);

    for (let i = 1; i <= 21; i++) {
      await testDb.seed(
        seedAuditLog({
          id: `log_${String(i).padStart(3, "0")}`,
          occurredAt: new Date(1000 + i),
          actorId: "usr_student_1",
          actedAsStaff: false,
          action: AuditLogAction.ReservationApply,
          targetType: AuditLogTargetType.Reservation,
          targetId: "rsv_target",
          groupId: "grp_alpha",
        }),
      );
    }

    const page1Result = await query.findByReservationId("rsv_target", 1);
    expect(page1Result.isOk()).toBe(true);
    const page1 = page1Result._unsafeUnwrap();
    expect(page1.items).toHaveLength(20);
    expect(page1.hasNextPage).toBe(true);
    expect(page1.items[0].id).toBe("log_021");

    const page2Result = await query.findByReservationId("rsv_target", 2);
    expect(page2Result.isOk()).toBe(true);
    const page2 = page2Result._unsafeUnwrap();
    expect(page2.items).toHaveLength(1);
    expect(page2.hasNextPage).toBe(false);
    expect(page2.items[0].id).toBe("log_001");
  });

  it("操作者が user に無ければ actorName: null", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);

    await testDb.seed(
      seedAuditLog({
        id: "log_deleted_user",
        occurredAt: new Date(1000),
        actorId: "usr_deleted", // 存在しないユーザーID
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
      }),
    );

    const result = await query.findByReservationId("rsv_target", 1);
    expect(result.isOk()).toBe(true);
    const list = result._unsafeUnwrap();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].actorName).toBeNull();
  });

  it("changes の user_id・facility_id が userNames・facilityNames に名前で入る。存在しない ID は辞書に入らない。ID が無ければ両方 {}", async () => {
    const db = testDb.db;
    const query = createReservationAuditLogListQuery(db);

    // 1. ID が無い場合
    await testDb.seed(
      seedAuditLog({
        id: "log_no_ids",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
        changes: { head_count: { before: 2, after: 4 } },
      }),
    );

    const result1 = await query.findByReservationId("rsv_target", 1);
    expect(result1.isOk()).toBe(true);
    const list1 = result1._unsafeUnwrap();
    expect(list1.userNames).toEqual({});
    expect(list1.facilityNames).toEqual({});

    // 2. 存在する user_id と facility_id、および存在しない ID を含む場合
    await testDb.seed(
      seedAuditLog({
        id: "log_with_ids",
        occurredAt: new Date(2000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.ReservationChange,
        targetType: AuditLogTargetType.Reservation,
        targetId: "rsv_target",
        groupId: "grp_alpha",
        changes: {
          user_id: { before: "usr_student_1", after: "usr_nonexistent" },
          facility_id: { before: "fac_room_a", after: "fac_nonexistent" },
        },
      }),
    );

    const result2 = await query.findByReservationId("rsv_target", 1);
    expect(result2.isOk()).toBe(true);
    const list2 = result2._unsafeUnwrap();
    expect(list2.userNames).toEqual({
      usr_student_1: "阪大太郎",
    });
    expect(list2.facilityNames).toEqual({
      fac_room_a: "会議室A",
    });
  });
});
