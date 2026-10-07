import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { createAuditLogSearchQuery } from "./audit-log-search-query";
import { useD1TestDb } from "../d1-test-db";

/*
 * Query は内部で `db.batch()` を使う。D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、
 * 同じ名前の列が 2 つあると 1 つに潰れて後ろの列がずれる。ここでは本物の D1 で流しているので、
 * 列名が重なる問い合わせを書けば、下の値の比較がそのまま落ちる。
 */
const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff",
      "事務局スタッフ",
      "staff@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_student_1",
      "阪大太郎",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_student_2",
      "阪大花子",
      "hanako@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_never_acted",
      "未操作ユーザー",
      "no-action@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_room_a",
      "ミーティングルームA",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_room_b",
      "3Dプリンター室",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_alpha",
      "アルファ部",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_beta",
      "ベータ研究会",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "res_1",
      "grp_alpha",
      "fac_room_a",
      1700000000000,
      1700003600000,
      4,
      "approved",
      "usr_student_1",
      0,
      0,
    ],
  );
});

describe("AuditLogSearchQuery (本物の D1 を使用したテスト)", () => {
  it("予約・施設・団体の情報が LEFT JOIN され、参照先が消えた記録も落ちずに取得できる", async () => {
    const db = testDb.db;
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 予約の記録（正常に施設・団体が結合される）
    await testDb.seed([
      insertLogSql,
      "log_res",
      10_000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_alpha",
      JSON.stringify({
        head_count: { before: null, after: 4 },
        user_id: { before: null, after: "usr_student_1" },
      }),
    ]);

    // 参照先（予約や団体やユーザー）が存在しない記録（消えたレコード）
    await testDb.seed([
      insertLogSql,
      "log_ghost",
      20_000,
      "usr_ghost_id", // user テーブルに存在しない
      0,
      AuditLogAction.ReservationCancel,
      AuditLogTargetType.Reservation,
      "res_deleted_id",
      "grp_deleted_id",
      JSON.stringify({}),
    ]);

    const query = createAuditLogSearchQuery(db);
    const result = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
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
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    await testDb.seed([
      insertLogSql,
      "log_changes",
      10_000,
      "usr_staff",
      1,
      AuditLogAction.FacilityUpdate,
      AuditLogTargetType.Facility,
      "fac_room_b",
      null,
      JSON.stringify({
        user_id: { before: "usr_student_1", after: "usr_student_2" },
        facility_id: { before: "fac_room_a", after: "fac_room_b" },
      }),
    ]);

    const query = createAuditLogSearchQuery(db);
    const result = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
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
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // usr_student_2 と usr_staff だけが記録に現れる（usr_never_acted は現れない）
    await testDb.seed([
      insertLogSql,
      "log_1",
      10_000,
      "usr_student_2",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_2",
      20_000,
      "usr_staff",
      1,
      AuditLogAction.GroupEnable,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      "{}",
    ]);

    const query = createAuditLogSearchQuery(db);
    const result = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();

    expect(result.actors).toEqual([
      { id: "usr_staff", name: "事務局スタッフ" },
      { id: "usr_student_2", name: "阪大花子" },
    ]);
  });

  it("各絞り込み（種類・団体・操作者・期間の境界）が正しく機能する", async () => {
    const db = testDb.db;
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    await testDb.seed([
      insertLogSql,
      "log_1",
      1000,
      "usr_student_1",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_2",
      2000,
      "usr_staff",
      1,
      AuditLogAction.FacilityUpdate,
      AuditLogTargetType.Facility,
      "fac_room_a",
      null,
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_3",
      3000,
      "usr_student_2",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_beta",
      "grp_beta",
      "{}",
    ]);

    const query = createAuditLogSearchQuery(db);

    // 1. 種類で絞り込み
    const resByType = (
      await query.search(
        {
          targetType: AuditLogTargetType.Facility,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();
    expect(resByType.items.map((i) => i.id)).toEqual(["log_2"]);

    // 2. 団体で絞り込み
    const resByGroup = (
      await query.search(
        {
          targetType: null,
          groupId: "grp_beta",
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();
    expect(resByGroup.items.map((i) => i.id)).toEqual(["log_3"]);

    // 3. 操作者で絞り込み
    const resByActor = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: "usr_student_1",
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();
    expect(resByActor.items.map((i) => i.id)).toEqual(["log_1"]);

    // 4. 期間の境界値テスト（occurredFrom は含む、occurredBefore は含まない）
    const resByTime = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: new Date(2000), // 2000 を含む
          occurredBefore: new Date(3000), // 3000 は含まない
        },
        1,
      )
    )._unsafeUnwrap();
    expect(resByTime.items.map((i) => i.id)).toEqual(["log_2"]);
  });

  it("並び順は occurred_at の降順、同時刻は id の降順になる", async () => {
    const db = testDb.db;
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 同時刻 1000 に 2 件投入
    await testDb.seed([
      insertLogSql,
      "log_a",
      1000,
      "usr_staff",
      1,
      AuditLogAction.GroupCreate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      "{}",
    ]);
    await testDb.seed([
      insertLogSql,
      "log_b",
      1000,
      "usr_staff",
      1,
      AuditLogAction.GroupCreate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      "{}",
    ]);
    // 時刻 2000 に 1 件投入
    await testDb.seed([
      insertLogSql,
      "log_c",
      2000,
      "usr_staff",
      1,
      AuditLogAction.GroupCreate,
      AuditLogTargetType.Group,
      "grp_alpha",
      "grp_alpha",
      "{}",
    ]);

    const query = createAuditLogSearchQuery(db);
    const result = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();

    // 2000 の log_c が先頭。時刻 1000 同士は id 降順で log_b -> log_a
    expect(result.items.map((i) => i.id)).toEqual(["log_c", "log_b", "log_a"]);
  });

  it("51 件目で hasNextPage が true になり、2 ページ目が正しく取得できる", async () => {
    const db = testDb.db;
    const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

    // 52 件のレコードを投入（1 ページあたり 50 件）
    for (let i = 1; i <= 52; i++) {
      const padded = String(i).padStart(3, "0");
      await testDb.seed([
        insertLogSql,
        `log_${padded}`,
        i * 100,
        "usr_staff",
        1,
        AuditLogAction.GroupCreate,
        AuditLogTargetType.Group,
        "grp_alpha",
        "grp_alpha",
        "{}",
      ]);
    }

    const query = createAuditLogSearchQuery(db);

    // 1 ページ目
    const page1 = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        1,
      )
    )._unsafeUnwrap();

    expect(page1.items.length).toBe(50);
    expect(page1.hasNextPage).toBe(true);
    // 最新は log_052
    expect(page1.items[0].id).toBe("log_052");

    // 2 ページ目
    const page2 = (
      await query.search(
        {
          targetType: null,
          groupId: null,
          actorId: null,
          occurredFrom: null,
          occurredBefore: null,
        },
        2,
      )
    )._unsafeUnwrap();

    expect(page2.items.length).toBe(2);
    expect(page2.hasNextPage).toBe(false);
    expect(page2.items.map((i) => i.id)).toEqual(["log_002", "log_001"]);
  });
});
