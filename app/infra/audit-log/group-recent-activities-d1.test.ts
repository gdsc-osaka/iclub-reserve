import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { createGroupRecentActivitiesQuery } from "./group-recent-activities-query";

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
      "usr_me",
      "自分",
      "me@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_other",
      "他メンバー",
      "other@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_1",
      "テスト団体1",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, description, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "fac_1",
      "工作室",
      "",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, facility_id, group_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "res_1",
      "fac_1",
      "grp_1",
      new Date("2026-10-20T10:00:00.000Z").getTime(),
      new Date("2026-10-20T12:00:00.000Z").getTime(),
      4,
      ReservationStatus.Provisional,
      "usr_other",
      new Date("2026-10-14T10:00:00.000Z").getTime(),
      new Date("2026-10-14T10:00:00.000Z").getTime(),
    ],
  );
});

describe("GroupRecentActivitiesQuery (D1 テスト)", () => {
  const insertLogSql = `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`;

  it("一般メンバーには団体の予約の記録だけが出て、団体・メンバーシップ・招待の記録は出ない（COND-012 (2)）", async () => {
    const db = testDb.db;
    const query = createGroupRecentActivitiesQuery(db);

    const occurredAt = new Date("2026-10-14T12:00:00.000Z").getTime();

    // 予約の記録
    await testDb.seed([
      insertLogSql,
      "log_res",
      occurredAt,
      "usr_other",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_1",
      JSON.stringify({}),
    ]);

    // 団体の記録
    await testDb.seed([
      insertLogSql,
      "log_grp",
      occurredAt + 10,
      "usr_other",
      0,
      AuditLogAction.GroupUpdate,
      AuditLogTargetType.Group,
      "grp_1",
      "grp_1",
      JSON.stringify({ name: { before: "前", after: "後" } }),
    ]);

    // 一般メンバーとして取得
    const result = await query.findRecentActivities({
      actorUserId: "usr_me",
      groups: [{ id: "grp_1", role: MembershipRole.Member }],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: 5,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      id: "log_res",
      actorName: "他メンバー",
      actedAsStaff: false,
      targetType: AuditLogTargetType.Reservation,
      groupId: "grp_1",
      groupName: "テスト団体1",
      // 行に出すために、予約の施設名と日時を結合して返す
      reservation: {
        facilityName: "工作室",
        startAt: new Date("2026-10-20T10:00:00.000Z"),
        endAt: new Date("2026-10-20T12:00:00.000Z"),
      },
    });
  });

  it("管理者には予約に加えて団体・メンバーシップ・招待の記録も出る（COND-012 (3)）", async () => {
    const db = testDb.db;
    const query = createGroupRecentActivitiesQuery(db);

    const occurredAt = new Date("2026-10-14T12:00:00.000Z").getTime();

    await testDb.seed(
      [
        insertLogSql,
        "log_res",
        occurredAt,
        "usr_other",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "res_1",
        "grp_1",
        JSON.stringify({}),
      ],
      [
        insertLogSql,
        "log_grp",
        occurredAt + 10,
        "usr_other",
        0,
        AuditLogAction.GroupUpdate,
        AuditLogTargetType.Group,
        "grp_1",
        "grp_1",
        JSON.stringify({}),
      ],
      [
        insertLogSql,
        "log_mem",
        occurredAt + 20,
        "usr_other",
        0,
        AuditLogAction.MembershipChangeRole,
        AuditLogTargetType.Membership,
        "mem_1",
        "grp_1",
        JSON.stringify({}),
      ],
      [
        insertLogSql,
        "log_inv",
        occurredAt + 30,
        "usr_other",
        0,
        AuditLogAction.InvitationSend,
        AuditLogTargetType.Invitation,
        "inv_1",
        "grp_1",
        JSON.stringify({}),
      ],
    );

    // 管理者として取得
    const result = await query.findRecentActivities({
      actorUserId: "usr_me",
      groups: [{ id: "grp_1", role: MembershipRole.Admin }],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: 5,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toHaveLength(4);
    const ids = result.value.map((v) => v.id);
    expect(ids).toContain("log_res");
    expect(ids).toContain("log_grp");
    expect(ids).toContain("log_mem");
    expect(ids).toContain("log_inv");
  });

  it("本人の操作と、予約に対する事務局の操作（actedAsStaff = true）は出ない", async () => {
    const db = testDb.db;
    const query = createGroupRecentActivitiesQuery(db);

    const occurredAt = new Date("2026-10-14T12:00:00.000Z").getTime();

    // 本人の操作
    await testDb.seed([
      insertLogSql,
      "log_my_action",
      occurredAt + 1,
      "usr_me",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_1",
      JSON.stringify({}),
    ]);

    // 予約に対する事務局の操作（未読に出るため最近の動きからは除く）
    await testDb.seed([
      insertLogSql,
      "log_staff_reservation",
      occurredAt + 2,
      "usr_staff",
      1,
      AuditLogAction.ReservationApprove,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_1",
      JSON.stringify({}),
    ]);

    // 他メンバーの操作
    await testDb.seed([
      insertLogSql,
      "log_other_action",
      occurredAt + 3,
      "usr_other",
      0,
      AuditLogAction.ReservationApply,
      AuditLogTargetType.Reservation,
      "res_1",
      "grp_1",
      JSON.stringify({}),
    ]);

    const result = await query.findRecentActivities({
      actorUserId: "usr_me",
      groups: [{ id: "grp_1", role: MembershipRole.Admin }],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: 5,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe("log_other_action");
  });

  it("団体の有効化など予約以外への事務局の操作は残る", async () => {
    const db = testDb.db;
    const query = createGroupRecentActivitiesQuery(db);

    const occurredAt = new Date("2026-10-14T12:00:00.000Z").getTime();

    // 団体に対する事務局の操作（団体の有効化）
    await testDb.seed([
      insertLogSql,
      "log_staff_group_enable",
      occurredAt,
      "usr_staff",
      1,
      AuditLogAction.GroupEnable,
      AuditLogTargetType.Group,
      "grp_1",
      "grp_1",
      JSON.stringify({ status: { before: "pending", after: "enabled" } }),
    ]);

    const result = await query.findRecentActivities({
      actorUserId: "usr_me",
      groups: [{ id: "grp_1", role: MembershipRole.Admin }],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: 5,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toHaveLength(1);
    // 「事務局」と伏せるのはユースケースの役目なので、ここでは名前と actedAsStaff をそのまま返す
    expect(result.value[0]).toMatchObject({
      id: "log_staff_group_enable",
      action: AuditLogAction.GroupEnable,
      actorName: "事務局スタッフ",
      actedAsStaff: true,
      reservation: null,
    });
  });

  it("役割は団体ごとに見て、所属していない団体の記録は出さない", async () => {
    const occurredAt = new Date("2026-10-14T12:00:00.000Z").getTime();
    await testDb.seed(
      [
        `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
        "grp_2",
        "テスト団体2",
        "enabled",
        0,
        0,
      ],
      [
        `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
        "grp_3",
        "所属していない団体",
        "enabled",
        0,
        0,
      ],
      // 管理者を務める団体 1 の団体の記録 → 出る
      [
        insertLogSql,
        "log_grp1_group",
        occurredAt,
        "usr_other",
        0,
        AuditLogAction.GroupUpdate,
        AuditLogTargetType.Group,
        "grp_1",
        "grp_1",
        JSON.stringify({}),
      ],
      // 一般メンバーである団体 2 の予約の記録 → 出る
      [
        insertLogSql,
        "log_grp2_reservation",
        occurredAt + 1,
        "usr_other",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "res_2",
        "grp_2",
        JSON.stringify({}),
      ],
      // 一般メンバーである団体 2 の団体の記録 → 出ない
      [
        insertLogSql,
        "log_grp2_group",
        occurredAt + 2,
        "usr_other",
        0,
        AuditLogAction.GroupUpdate,
        AuditLogTargetType.Group,
        "grp_2",
        "grp_2",
        JSON.stringify({}),
      ],
      // 所属していない団体 3 の予約の記録 → 出ない
      [
        insertLogSql,
        "log_grp3_reservation",
        occurredAt + 3,
        "usr_other",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "res_3",
        "grp_3",
        JSON.stringify({}),
      ],
    );

    const result = await createGroupRecentActivitiesQuery(testDb.db).findRecentActivities({
      actorUserId: "usr_me",
      groups: [
        { id: "grp_1", role: MembershipRole.Admin },
        { id: "grp_2", role: MembershipRole.Member },
      ],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: 5,
    });

    expect(result._unsafeUnwrap().map((item) => item.id)).toEqual([
      "log_grp2_reservation",
      "log_grp1_group",
    ]);
  });

  it("起点より前の記録は出さず、新しい順に上限の件数まで返す", async () => {
    const since = new Date("2026-10-08T12:00:00.000Z");
    await testDb.seed(
      // 起点ちょうど → 出る
      [
        insertLogSql,
        "log_at_since",
        since.getTime(),
        "usr_other",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "res_1",
        "grp_1",
        JSON.stringify({}),
      ],
      // 起点の 1 ミリ秒前 → 出ない
      [
        insertLogSql,
        "log_before_since",
        since.getTime() - 1,
        "usr_other",
        0,
        AuditLogAction.ReservationApply,
        AuditLogTargetType.Reservation,
        "res_1",
        "grp_1",
        JSON.stringify({}),
      ],
      [
        insertLogSql,
        "log_newer",
        since.getTime() + 1000,
        "usr_other",
        0,
        AuditLogAction.ReservationEditProvisional,
        AuditLogTargetType.Reservation,
        "res_1",
        "grp_1",
        JSON.stringify({}),
      ],
      [
        insertLogSql,
        "log_newest",
        since.getTime() + 2000,
        "usr_other",
        0,
        AuditLogAction.ReservationWithdraw,
        AuditLogTargetType.Reservation,
        "res_1",
        "grp_1",
        JSON.stringify({}),
      ],
    );

    const query = createGroupRecentActivitiesQuery(testDb.db);
    const args = {
      actorUserId: "usr_me",
      groups: [{ id: "grp_1", role: MembershipRole.Member }],
      since,
    };

    const all = await query.findRecentActivities({ ...args, limit: 5 });
    expect(all._unsafeUnwrap().map((item) => item.id)).toEqual([
      "log_newest",
      "log_newer",
      "log_at_since",
    ]);

    const limited = await query.findRecentActivities({ ...args, limit: 2 });
    expect(limited._unsafeUnwrap().map((item) => item.id)).toEqual(["log_newest", "log_newer"]);
  });
});
