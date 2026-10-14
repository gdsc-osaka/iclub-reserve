/**
 * 団体側の未読問い合わせ（GroupUnreadUpdatesQuery）をローカル D1 に対して検証するテスト。
 *
 * COND-026 の団体側の各判定（対象者、対象の出来事、30日以内・開始日以降・既読日時との境目、1件1行集約と「ほか n 件」）を検証する。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useD1TestDb } from "../d1-test-db";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus, unreadEventsSince } from "~/domain/reservation";
import { GroupUnreadEventType } from "~/query/reservation/group-unread-updates";
import { createGroupUnreadUpdatesQuery } from "./group-unread-updates-query";

const testDb = useD1TestDb();

const USER_ADMIN = { id: "usr_admin", name: "管理者", email: "admin@example.com" };
const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };
const USER_MEMBER = { id: "usr_member", name: "一般部員", email: "member@example.com" };
const USER_PRIOR_SENDER = { id: "usr_sender", name: "過去送信者", email: "sender@example.com" };
const USER_STAFF = { id: "usr_staff", name: "事務局", email: "staff@example.com" };

const NOW = new Date("2026-10-20T12:00:00+09:00");

beforeEach(async () => {
  // ユーザーの作成
  for (const u of [USER_ADMIN, USER_APPLICANT, USER_MEMBER, USER_PRIOR_SENDER, USER_STAFF]) {
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      u.id,
      u.name,
      u.email,
      1,
      0,
      0,
      u.id === USER_STAFF.id ? 1 : 0,
    ]);
  }

  // 団体と施設
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

  // メンバーシップ
  await testDb.seed(
    [
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "mem_admin",
      "grp_test",
      USER_ADMIN.id,
      MembershipRole.Admin,
      0,
      0,
    ],
    [
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "mem_applicant",
      "grp_test",
      USER_APPLICANT.id,
      MembershipRole.Member,
      0,
      0,
    ],
    [
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "mem_member",
      "grp_test",
      USER_MEMBER.id,
      MembershipRole.Member,
      0,
      0,
    ],
    [
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "mem_sender",
      "grp_test",
      USER_PRIOR_SENDER.id,
      MembershipRole.Member,
      0,
      0,
    ],
  );
});

async function insertReservation(
  id: string,
  createdBy: string,
  status: ReservationStatus = ReservationStatus.Provisional,
) {
  await testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    "grp_test",
    "fac_1",
    new Date("2026-10-25T10:00:00+09:00").getTime(),
    new Date("2026-10-25T12:00:00+09:00").getTime(),
    2,
    status,
    createdBy,
    0,
    0,
  ]);
}

async function insertMessage(
  id: string,
  reservationId: string,
  senderId: string,
  sentAsStaff: boolean,
  body: string,
  sentAt: Date,
) {
  await testDb.seed([
    `INSERT INTO "reservation_message" (id, reservation_id, sender_id, sent_as_staff, body, sent_at) VALUES (?,?,?,?,?,?)`,
    id,
    reservationId,
    senderId,
    sentAsStaff ? 1 : 0,
    body,
    sentAt.getTime(),
  ]);
}

async function insertAuditLog(
  id: string,
  targetId: string,
  actorId: string,
  actedAsStaff: boolean,
  action: AuditLogAction,
  occurredAt: Date,
) {
  await testDb.seed([
    `INSERT INTO "audit_log" (id, occurred_at, actor_id, acted_as_staff, action, target_type, target_id, group_id, changes) VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    occurredAt.getTime(),
    actorId,
    actedAsStaff ? 1 : 0,
    action,
    AuditLogTargetType.Reservation,
    targetId,
    "grp_test",
    JSON.stringify({}),
  ]);
}

async function insertReadRecord(reservationId: string, userId: string, lastReadAt: Date) {
  await testDb.seed([
    `INSERT INTO "reservation_read" (reservation_id, user_id, last_read_at) VALUES (?,?,?)`,
    reservationId,
    userId,
    lastReadAt.getTime(),
  ]);
}

describe("findUnreadForUser (D1)", () => {
  it("事務局からのメッセージは申請者・管理者・過去の送信者に出るが、一般メンバーには出ない", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);
    await insertReservation("res_1", USER_APPLICANT.id);

    // 過去送信者による団体側メッセージ
    await insertMessage(
      "msg_prev",
      "res_1",
      USER_PRIOR_SENDER.id,
      false,
      "利用目的の補足です",
      new Date("2026-10-15T10:00:00+09:00"),
    );

    // 事務局からのメッセージ
    await insertMessage(
      "msg_staff",
      "res_1",
      USER_STAFF.id,
      true,
      "承知しました。追加備品は必要ですか？",
      new Date("2026-10-16T10:00:00+09:00"),
    );

    // 1. 申請者
    const resApplicant = await query.findUnreadForUser(USER_APPLICANT.id, NOW);
    expect(resApplicant.isOk()).toBe(true);
    if (!resApplicant.isOk()) return;
    expect(resApplicant.value.items).toHaveLength(1);
    // 団体名と施設名は、どちらも name という列から取る。取り違えずに入っていること
    expect(resApplicant.value.items[0]?.groupName).toBe("テスト団体");
    expect(resApplicant.value.items[0]?.facilityName).toBe("会議室 1");
    expect(resApplicant.value.items[0]?.reservationId).toBe("res_1");
    expect(resApplicant.value.items[0]?.latestEvent.type).toBe(GroupUnreadEventType.Message);
    expect(resApplicant.value.items[0]?.latestEvent.messageBody).toBe(
      "承知しました。追加備品は必要ですか？",
    );

    // 2. 団体管理者
    const resAdmin = await query.findUnreadForUser(USER_ADMIN.id, NOW);
    expect(resAdmin.isOk()).toBe(true);
    if (!resAdmin.isOk()) return;
    expect(resAdmin.value.items).toHaveLength(1);

    // 3. 過去送信者
    const resSender = await query.findUnreadForUser(USER_PRIOR_SENDER.id, NOW);
    expect(resSender.isOk()).toBe(true);
    if (!resSender.isOk()) return;
    expect(resSender.value.items).toHaveLength(1);

    // 4. 何もしていない一般メンバー（出ない）
    const resMember = await query.findUnreadForUser(USER_MEMBER.id, NOW);
    expect(resMember.isOk()).toBe(true);
    if (!resMember.isOk()) return;
    expect(resMember.value.items).toHaveLength(0);
  });

  it("団体を外れた人（group_member にいない）には出ない", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);
    await insertReservation("res_1", USER_APPLICANT.id);

    await insertMessage(
      "msg_staff",
      "res_1",
      USER_STAFF.id,
      true,
      "事務局メッセージ",
      new Date("2026-10-16T10:00:00+09:00"),
    );

    // 申請者をメンバーから削除
    await testDb.seed([`DELETE FROM "group_member" WHERE user_id = ?`, USER_APPLICANT.id]);

    const res = await query.findUnreadForUser(USER_APPLICANT.id, NOW);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.items).toHaveLength(0);
  });

  it("自分の操作は未読に含まれない", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);
    await insertReservation("res_1", USER_ADMIN.id);

    // 管理者自身が事務局でもあり、事務局としてメッセージを送った場合
    await insertMessage(
      "msg_self",
      "res_1",
      USER_ADMIN.id,
      true,
      "自作自演メッセージ",
      new Date("2026-10-16T10:00:00+09:00"),
    );

    const res = await query.findUnreadForUser(USER_ADMIN.id, NOW);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.items).toHaveLength(0);
  });

  it("last_read_at より前と、30 日より前の出来事は出ない", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);
    const since = unreadEventsSince(NOW);

    // 1. 30 日の起点のすぐ前のメッセージ（出ない）
    await insertReservation("res_old", USER_APPLICANT.id);
    await insertMessage(
      "msg_old_30d",
      "res_old",
      USER_STAFF.id,
      true,
      "30日より前",
      new Date(since.getTime() - 60000),
    );

    // 2. 30 日の起点のすぐ後のメッセージ（出る）
    await insertReservation("res_edge", USER_APPLICANT.id);
    await insertMessage(
      "msg_edge_30d",
      "res_edge",
      USER_STAFF.id,
      true,
      "30日以内",
      new Date(since.getTime() + 60000),
    );

    // 3. last_read_at より前のメッセージ
    await insertReservation("res_read", USER_APPLICANT.id);
    await insertMessage(
      "msg_read",
      "res_read",
      USER_STAFF.id,
      true,
      "既に読んだメッセージ",
      new Date("2026-10-15T10:00:00+09:00"),
    );
    await insertReadRecord("res_read", USER_APPLICANT.id, new Date("2026-10-15T11:00:00+09:00"));

    // 4. last_read_at より後に新着メッセージが来た予約
    await insertReservation("res_new", USER_APPLICANT.id);
    await insertMessage(
      "msg_new_old",
      "res_new",
      USER_STAFF.id,
      true,
      "古いメッセージ",
      new Date("2026-10-15T10:00:00+09:00"),
    );
    await insertReadRecord("res_new", USER_APPLICANT.id, new Date("2026-10-15T11:00:00+09:00"));
    await insertMessage(
      "msg_new_unread",
      "res_new",
      USER_STAFF.id,
      true,
      "新しいメッセージ",
      new Date("2026-10-16T10:00:00+09:00"),
    );

    const res = await query.findUnreadForUser(USER_APPLICANT.id, NOW);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;

    // res_new と res_edge だけが出る（新しい順）
    expect(res.value.items.map((item) => item.reservationId)).toEqual(["res_new", "res_edge"]);
    expect(res.value.items[0]?.latestEvent.messageBody).toBe("新しいメッセージ");
    // res_new の古いメッセージは last_read_at より前なので otherCount にも入らない
    expect(res.value.items[0]?.otherCount).toBe(0);
  });

  it("同じ予約の複数の出来事が 1 行にまとまり、ほか n 件の数が合う", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);
    await insertReservation("res_1", USER_APPLICANT.id, ReservationStatus.Approved);

    // 出来事 1: 承認
    await insertAuditLog(
      "log_app",
      "res_1",
      USER_STAFF.id,
      true,
      AuditLogAction.ReservationApprove,
      new Date("2026-10-15T10:00:00+09:00"),
    );
    // 出来事 2: メッセージ 1
    await insertMessage(
      "msg_1",
      "res_1",
      USER_STAFF.id,
      true,
      "承認しました",
      new Date("2026-10-16T10:00:00+09:00"),
    );
    // 出来事 3: メッセージ 2（最新）
    await insertMessage(
      "msg_2",
      "res_1",
      USER_STAFF.id,
      true,
      "鍵の受け渡しについて",
      new Date("2026-10-17T10:00:00+09:00"),
    );

    const res = await query.findUnreadForUser(USER_APPLICANT.id, NOW);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;

    expect(res.value.items).toHaveLength(1);
    const item = res.value.items[0]!;
    expect(item.reservationId).toBe("res_1");
    expect(item.latestEvent.type).toBe(GroupUnreadEventType.Message);
    expect(item.latestEvent.messageBody).toBe("鍵の受け渡しについて");
    expect(item.otherCount).toBe(2); // 承認 + メッセージ 1
  });

  it("10 件を超えた予約は overflowCount に反映され、allUnreadReservationIds にはすべて含まれる", async () => {
    const query = createGroupUnreadUpdatesQuery(testDb.db);

    // 12 件の予約を作成し、それぞれメッセージを付ける
    for (let i = 1; i <= 12; i++) {
      const resId = `res_batch_${i}`;
      await insertReservation(resId, USER_APPLICANT.id);
      await insertMessage(
        `msg_batch_${i}`,
        resId,
        USER_STAFF.id,
        true,
        `メッセージ ${i}`,
        new Date(new Date("2026-10-15T00:00:00+09:00").getTime() + i * 3600000),
      );
    }

    const res = await query.findUnreadForUser(USER_APPLICANT.id, NOW);
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;

    expect(res.value.items).toHaveLength(10);
    expect(res.value.overflowCount).toBe(2);
    expect(res.value.allUnreadReservationIds).toHaveLength(12);
    // 最新のものが先頭（res_batch_12）
    expect(res.value.items[0]?.reservationId).toBe("res_batch_12");
  });
});
