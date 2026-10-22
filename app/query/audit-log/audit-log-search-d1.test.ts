import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import {
  seedAuditLog,
  seedFacility,
  seedGroup,
  seedReservation,
  seedUser,
} from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findAuditLogSearchResult } from "./audit-log-search";

/*
 * 内部で `db.batch()` を使う。D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、
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
    seedUser({
      id: "usr_never_acted",
      name: "未操作ユーザー",
      email: "no-action@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedFacility({ id: "fac_room_a", name: "ミーティングルームA" }),
    seedFacility({ id: "fac_room_b", name: "3Dプリンター室" }),
    seedGroup({ id: "grp_alpha", name: "アルファ部" }),
    seedGroup({ id: "grp_beta", name: "ベータ研究会" }),
    seedReservation({
      id: "res_1",
      groupId: "grp_alpha",
      facilityId: "fac_room_a",
      startAt: new Date(1700000000000),
      endAt: new Date(1700003600000),
      headCount: 4,
      status: ReservationStatus.Approved,
      createdBy: "usr_student_1",
    }),
  );
});

describe("findAuditLogSearchResult", () => {
  it("事務局でない人には Forbidden を返す（COND-009・COND-012(1)）", async () => {
    const result = await findAuditLogSearchResult(testDb.db, {
      isStaff: false,
      filter: {
        targetType: null,
        groupId: null,
        actorId: null,
        occurredFrom: null,
        occurredBefore: null,
      },
      page: 1,
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("予約・施設・団体の情報が LEFT JOIN され、参照先が消えた記録も落ちずに取得できる", async () => {
    const db = testDb.db;

    // 予約の記録（正常に施設・団体が結合される）
    await testDb.seed(
      seedAuditLog({
        id: "log_res",
        occurredAt: new Date(10_000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_alpha",
        changes: {
          head_count: { before: null, after: 4 },
          user_id: { before: null, after: "usr_student_1" },
        },
      }),
      // 参照先（予約や団体やユーザー）が存在しない記録（消えたレコード）
      seedAuditLog({
        id: "log_ghost",
        occurredAt: new Date(20_000),
        actorId: "usr_ghost_id", // user テーブルに存在しない
        actedAsStaff: false,
        action: AuditLogAction.ReservationCancel,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_deleted_id",
        groupId: "grp_deleted_id",
      }),
    );

    const result = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();

    expect(result.items.length).toBe(2);

    // 1行目: log_ghost (occurred_at: 20_000)
    const ghostItem = result.items[0];
    expect(ghostItem.id).toBe("log_ghost");
    expect(ghostItem.actorName).toBeNull();
    expect(ghostItem.groupName).toBeNull();
    expect(ghostItem.reservation).toBeNull();

    // 2行目: log_res (occurred_at: 10_000)
    const resItem = result.items[1];
    expect(resItem.id).toBe("log_res");
    expect(resItem.actorName).toBe("阪大太郎");
    expect(resItem.groupName).toBe("アルファ部");
    expect(resItem.reservation).toEqual({
      facilityName: "ミーティングルームA",
      startAt: new Date(1_700_000_000_000),
    });
  });

  it("changes に現れる user_id と facility_id の名称が解決される", async () => {
    const db = testDb.db;

    await testDb.seed(
      seedAuditLog({
        id: "log_changes",
        occurredAt: new Date(10_000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.FacilityUpdate,
        targetType: AuditLogTargetType.Facility,
        targetId: "fac_room_b",
        groupId: null,
        changes: {
          user_id: { before: "usr_student_1", after: "usr_student_2" },
          facility_id: { before: "fac_room_a", after: "fac_room_b" },
        },
      }),
    );

    const result = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();

    expect(result.userNames).toEqual({
      usr_student_1: "阪大太郎",
      usr_student_2: "阪大花子",
    });
    expect(result.facilityNames).toEqual({
      fac_room_a: "ミーティングルームA",
      fac_room_b: "3Dプリンター室",
    });
    // 施設/設備の記録には、対象の施設名が付く
    expect(result.items[0].facilityName).toBe("3Dプリンター室");
    expect(result.items[0].reservation).toBeNull();
  });

  it("操作者の選択肢（actors）には記録に一度でも現れた人だけが名前昇順で含まれる", async () => {
    const db = testDb.db;
    // usr_student_2 と usr_staff だけが記録に現れる（usr_never_acted は現れない）
    await testDb.seed(
      seedAuditLog({
        id: "log_1",
        occurredAt: new Date(10_000),
        actorId: "usr_student_2",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_2",
        occurredAt: new Date(20_000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.GroupEnable,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
    );

    const result = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();

    expect(result.actors).toEqual([
      { id: "usr_staff", name: "事務局スタッフ" },
      { id: "usr_student_2", name: "阪大花子" },
    ]);
  });

  it("各絞り込み（種類・団体・操作者・期間の境界）が正しく機能する", async () => {
    const db = testDb.db;

    await testDb.seed(
      seedAuditLog({
        id: "log_1",
        occurredAt: new Date(1000),
        actorId: "usr_student_1",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_2",
        occurredAt: new Date(2000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.FacilityUpdate,
        targetType: AuditLogTargetType.Facility,
        targetId: "fac_room_a",
        groupId: null,
      }),
      seedAuditLog({
        id: "log_3",
        occurredAt: new Date(3000),
        actorId: "usr_student_2",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_beta",
        groupId: "grp_beta",
      }),
    );

    // 1. 種類で絞り込み
    const resByType = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: AuditLogTargetType.Facility,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();
    expect(resByType.items.map((i) => i.id)).toEqual(["log_2"]);

    // 2. 団体で絞り込み
    const resByGroup = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: "grp_beta",
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();
    expect(resByGroup.items.map((i) => i.id)).toEqual(["log_3"]);

    // 3. 操作者で絞り込み
    const resByActor = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: "usr_student_1",
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();
    expect(resByActor.items.map((i) => i.id)).toEqual(["log_1"]);

    // 4. 期間の境界値テスト（occurredFrom は含む、occurredBefore は含まない）
    const resByTime = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: new Date(2000), // 2000 を含む
          occurredBefore: new Date(3000), // 3000 は含まない
        },
        page: 1,
      })
    )._unsafeUnwrap();
    expect(resByTime.items.map((i) => i.id)).toEqual(["log_2"]);
  });

  it("並び順は occurred_at の降順、同時刻は id の降順になる", async () => {
    const db = testDb.db;

    // 同時刻 1000 に 2 件投入、時刻 2000 に 1 件投入
    await testDb.seed(
      seedAuditLog({
        id: "log_a",
        occurredAt: new Date(1000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.GroupCreate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_b",
        occurredAt: new Date(1000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.GroupCreate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
      seedAuditLog({
        id: "log_c",
        occurredAt: new Date(2000),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.GroupCreate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_alpha",
        groupId: "grp_alpha",
      }),
    );

    const result = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();

    // 2000 の log_c が先頭。時刻 1000 同士は id 降順で log_b -> log_a
    expect(result.items.map((i) => i.id)).toEqual(["log_c", "log_b", "log_a"]);
  });

  it("51 件目で hasNextPage が true になり、2 ページ目が正しく取得できる", async () => {
    const db = testDb.db;

    // 52 件のレコードを投入（1 ページあたり 50 件）
    for (let i = 1; i <= 52; i++) {
      const padded = String(i).padStart(3, "0");
      await testDb.seed(
        seedAuditLog({
          id: `log_${padded}`,
          occurredAt: new Date(i * 100),
          actorId: "usr_staff",
          actedAsStaff: true,
          action: AuditLogAction.GroupCreate,
          targetType: AuditLogTargetType.Group,
          targetId: "grp_alpha",
          groupId: "grp_alpha",
        }),
      );
    }

    // 1 ページ目
    const page1 = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 1,
      })
    )._unsafeUnwrap();

    expect(page1.items.length).toBe(50);
    expect(page1.hasNextPage).toBe(true);
    // 最新は log_052
    expect(page1.items[0].id).toBe("log_052");

    // 2 ページ目
    const page2 = (
      await findAuditLogSearchResult(db, {
        isStaff: true,
        filter: {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        page: 2,
      })
    )._unsafeUnwrap();

    expect(page2.items.length).toBe(2);
    expect(page2.hasNextPage).toBe(false);
    expect(page2.items.map((i) => i.id)).toEqual(["log_002", "log_001"]);
  });
});
