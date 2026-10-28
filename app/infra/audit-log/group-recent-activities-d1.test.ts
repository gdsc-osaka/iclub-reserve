import { beforeEach, describe, expect, it } from "vite-plus/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "../d1-test-db";
import { seedAuditLog, seedFacility, seedGroup, seedReservation, seedUser } from "../d1-test-seeds";
import { createGroupRecentActivitiesQuery } from "./group-recent-activities-query";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({
      id: "usr_staff",
      name: "事務局スタッフ",
      email: "staff@osaka-u.ac.jp",
      is_staff: true,
    }),
    seedUser({ id: "usr_me", name: "自分", email: "me@ecs.osaka-u.ac.jp", is_staff: false }),
    seedUser({
      id: "usr_other",
      name: "他メンバー",
      email: "other@ecs.osaka-u.ac.jp",
      is_staff: false,
    }),
    seedGroup({ id: "grp_1", name: "テスト団体1" }),
    seedFacility({ id: "fac_1", name: "工作室", description: "", isActive: true }),
    seedReservation({
      id: "res_1",
      facilityId: "fac_1",
      groupId: "grp_1",
      startAt: new Date("2026-10-20T10:00:00.000Z"),
      endAt: new Date("2026-10-20T12:00:00.000Z"),
      headCount: 4,
      status: ReservationStatus.Provisional,
      createdBy: "usr_other",
      createdAt: new Date("2026-10-14T10:00:00.000Z"),
      updatedAt: new Date("2026-10-14T10:00:00.000Z"),
    }),
  );
});

describe("GroupRecentActivitiesQuery (D1 テスト)", () => {
  it("一般メンバーには団体の予約の記録だけが出て、団体・メンバーシップ・招待の記録は出ない（COND-012 (2)）", async () => {
    const db = testDb.db;
    const query = createGroupRecentActivitiesQuery(db);

    const occurredAt = new Date("2026-10-14T12:00:00.000Z");

    // 予約の記録
    await testDb.seed(
      seedAuditLog({
        id: "log_res",
        occurredAt,
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
    );

    // 団体の記録
    await testDb.seed(
      seedAuditLog({
        id: "log_grp",
        occurredAt: new Date(occurredAt.getTime() + 10),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_1",
        groupId: "grp_1",
        changes: { name: { before: "前", after: "後" } },
      }),
    );

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

    const occurredAt = new Date("2026-10-14T12:00:00.000Z");

    await testDb.seed(
      seedAuditLog({
        id: "log_res",
        occurredAt,
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_grp",
        occurredAt: new Date(occurredAt.getTime() + 10),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_mem",
        occurredAt: new Date(occurredAt.getTime() + 20),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.MembershipChangeRole,
        targetType: AuditLogTargetType.Membership,
        targetId: "mem_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_inv",
        occurredAt: new Date(occurredAt.getTime() + 30),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.InvitationSend,
        targetType: AuditLogTargetType.Invitation,
        targetId: "inv_1",
        groupId: "grp_1",
      }),
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

    const occurredAt = new Date("2026-10-14T12:00:00.000Z");

    // 本人の操作
    await testDb.seed(
      seedAuditLog({
        id: "log_my_action",
        occurredAt: new Date(occurredAt.getTime() + 1),
        actorId: "usr_me",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
    );

    // 予約に対する事務局の操作（未読に出るため最近の動きからは除く）
    await testDb.seed(
      seedAuditLog({
        id: "log_staff_reservation",
        occurredAt: new Date(occurredAt.getTime() + 2),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.ReservationApprove,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_staff_unlock_update",
        occurredAt: new Date(occurredAt.getTime() + 2),
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.ReservationUnlockArrangementUpdate,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
    );

    // 他メンバーの操作
    await testDb.seed(
      seedAuditLog({
        id: "log_other_action",
        occurredAt: new Date(occurredAt.getTime() + 3),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
    );

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

    const occurredAt = new Date("2026-10-14T12:00:00.000Z");

    // 団体に対する事務局の操作（団体の有効化）
    await testDb.seed(
      seedAuditLog({
        id: "log_staff_group_enable",
        occurredAt,
        actorId: "usr_staff",
        actedAsStaff: true,
        action: AuditLogAction.GroupEnable,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_1",
        groupId: "grp_1",
        changes: { status: { before: "pending", after: "enabled" } },
      }),
    );

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
    const occurredAt = new Date("2026-10-14T12:00:00.000Z");
    await testDb.seed(
      seedGroup({ id: "grp_2", name: "テスト団体2" }),
      seedGroup({ id: "grp_3", name: "所属していない団体" }),
      // 管理者を務める団体 1 の団体の記録 → 出る
      seedAuditLog({
        id: "log_grp1_group",
        occurredAt,
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_1",
        groupId: "grp_1",
      }),
      // 一般メンバーである団体 2 の予約の記録 → 出る
      seedAuditLog({
        id: "log_grp2_reservation",
        occurredAt: new Date(occurredAt.getTime() + 1),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_2",
        groupId: "grp_2",
      }),
      // 一般メンバーである団体 2 の団体の記録 → 出ない
      seedAuditLog({
        id: "log_grp2_group",
        occurredAt: new Date(occurredAt.getTime() + 2),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.GroupUpdate,
        targetType: AuditLogTargetType.Group,
        targetId: "grp_2",
        groupId: "grp_2",
      }),
      // 所属していない団体 3 の予約の記録 → 出ない
      seedAuditLog({
        id: "log_grp3_reservation",
        occurredAt: new Date(occurredAt.getTime() + 3),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_3",
        groupId: "grp_3",
      }),
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
      seedAuditLog({
        id: "log_at_since",
        occurredAt: since,
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
      // 起点の 1 ミリ秒前 → 出ない
      seedAuditLog({
        id: "log_before_since",
        occurredAt: new Date(since.getTime() - 1),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationApply,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_newer",
        occurredAt: new Date(since.getTime() + 1000),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationEditProvisional,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
      seedAuditLog({
        id: "log_newest",
        occurredAt: new Date(since.getTime() + 2000),
        actorId: "usr_other",
        actedAsStaff: false,
        action: AuditLogAction.ReservationWithdraw,
        targetType: AuditLogTargetType.Reservation,
        targetId: "res_1",
        groupId: "grp_1",
      }),
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
