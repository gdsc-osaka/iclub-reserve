/**
 * 団体側の未読問い合わせ（findGroupUnreadUpdates）をローカル D1 に対して検証するテスト。
 *
 * COND-026 の団体側の各判定（対象者、対象の出来事、30日以内・開始日以降・既読日時との境目、1件1行集約と「ほか n 件」）を検証する。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { GroupUnreadEventType, ReservationStatus, unreadEventsSince } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import {
  seedAuditLog,
  seedFacility,
  seedGroup,
  seedMember,
  seedReservation,
  seedReservationMessage,
  seedReservationRead,
  seedUser,
} from "~/infra/d1-test-seeds";
import { findGroupUnreadUpdates } from "./group-unread-updates";

const testDb = useD1TestDb();

const USER_ADMIN = { id: "usr_admin", name: "管理者", email: "admin@example.com" };
const USER_APPLICANT = { id: "usr_applicant", name: "申請者", email: "applicant@example.com" };
const USER_MEMBER = { id: "usr_member", name: "一般部員", email: "member@example.com" };
const USER_PRIOR_SENDER = { id: "usr_sender", name: "過去送信者", email: "sender@example.com" };
const USER_STAFF = { id: "usr_staff", name: "事務局", email: "staff@example.com" };

const NOW = new Date("2026-10-20T12:00:00+09:00");

beforeEach(async () => {
  await testDb.seed(
    ...[USER_ADMIN, USER_APPLICANT, USER_MEMBER, USER_PRIOR_SENDER, USER_STAFF].map((u) =>
      seedUser({ id: u.id, name: u.name, email: u.email, is_staff: u.id === USER_STAFF.id }),
    ),
    seedGroup({ id: "grp_test", name: "テスト団体" }),
    seedFacility({ id: "fac_1", name: "会議室 1" }),
    seedMember({
      id: "mem_admin",
      groupId: "grp_test",
      userId: USER_ADMIN.id,
      role: MembershipRole.Admin,
    }),
    seedMember({
      id: "mem_applicant",
      groupId: "grp_test",
      userId: USER_APPLICANT.id,
      role: MembershipRole.Member,
    }),
    seedMember({
      id: "mem_member",
      groupId: "grp_test",
      userId: USER_MEMBER.id,
      role: MembershipRole.Member,
    }),
    seedMember({
      id: "mem_sender",
      groupId: "grp_test",
      userId: USER_PRIOR_SENDER.id,
      role: MembershipRole.Member,
    }),
  );
});

async function insertReservation(
  id: string,
  createdBy: string,
  status: ReservationStatus = ReservationStatus.Provisional,
) {
  await testDb.seed(
    seedReservation({
      id,
      groupId: "grp_test",
      facilityId: "fac_1",
      startAt: new Date("2026-10-25T10:00:00+09:00"),
      endAt: new Date("2026-10-25T12:00:00+09:00"),
      headCount: 2,
      status,
      createdBy,
    }),
  );
}

async function insertMessage(
  id: string,
  reservationId: string,
  senderId: string,
  sentAsStaff: boolean,
  body: string,
  sentAt: Date,
) {
  await testDb.seed(
    seedReservationMessage({ id, reservationId, senderId, sentAsStaff, body, sentAt }),
  );
}

async function insertAuditLog(
  id: string,
  targetId: string,
  actorId: string,
  actedAsStaff: boolean,
  action: AuditLogAction,
  occurredAt: Date,
) {
  await testDb.seed(
    seedAuditLog({
      id,
      occurredAt,
      actorId,
      actedAsStaff,
      action,
      targetType: AuditLogTargetType.Reservation,
      targetId,
      groupId: "grp_test",
      changes: {},
    }),
  );
}

async function insertReadRecord(reservationId: string, userId: string, lastReadAt: Date) {
  await testDb.seed(seedReservationRead({ reservationId, userId, lastReadAt }));
}

describe("findGroupUnreadUpdates", () => {
  it("事務局からのメッセージは申請者・管理者・過去の送信者に出るが、一般メンバーには出ない", async () => {
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
    const resApplicant = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_APPLICANT.id,
      now: NOW,
    });
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
    const resAdmin = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_ADMIN.id,
      now: NOW,
    });
    expect(resAdmin.isOk()).toBe(true);
    if (!resAdmin.isOk()) return;
    expect(resAdmin.value.items).toHaveLength(1);

    // 3. 過去送信者
    const resSender = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_PRIOR_SENDER.id,
      now: NOW,
    });
    expect(resSender.isOk()).toBe(true);
    if (!resSender.isOk()) return;
    expect(resSender.value.items).toHaveLength(1);

    // 4. 何もしていない一般メンバー（出ない）
    const resMember = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_MEMBER.id,
      now: NOW,
    });
    expect(resMember.isOk()).toBe(true);
    if (!resMember.isOk()) return;
    expect(resMember.value.items).toHaveLength(0);
  });

  it("団体を外れた人（group_member にいない）には出ない", async () => {
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

    const res = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_APPLICANT.id,
      now: NOW,
    });
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.items).toHaveLength(0);
  });

  it("自分の操作は未読に含まれない", async () => {
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

    const res = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_ADMIN.id,
      now: NOW,
    });
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;
    expect(res.value.items).toHaveLength(0);
  });

  it("last_read_at より前と、30 日より前の出来事は出ない", async () => {
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

    const res = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_APPLICANT.id,
      now: NOW,
    });
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;

    // res_new と res_edge だけが出る（新しい順）
    expect(res.value.items.map((item) => item.reservationId)).toEqual(["res_new", "res_edge"]);
    expect(res.value.items[0]?.latestEvent.messageBody).toBe("新しいメッセージ");
    // res_new の古いメッセージは last_read_at より前なので otherCount にも入らない
    expect(res.value.items[0]?.otherCount).toBe(0);
  });

  it("同じ予約の複数の出来事が 1 行にまとまり、ほか n 件の数が合う", async () => {
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

    const res = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_APPLICANT.id,
      now: NOW,
    });
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

    const res = await findGroupUnreadUpdates(testDb.db, {
      actorUserId: USER_APPLICANT.id,
      now: NOW,
    });
    expect(res.isOk()).toBe(true);
    if (!res.isOk()) return;

    expect(res.value.items).toHaveLength(10);
    expect(res.value.overflowCount).toBe(2);
    expect(res.value.allUnreadReservationIds).toHaveLength(12);
    // 最新のものが先頭（res_batch_12）
    expect(res.value.items[0]?.reservationId).toBe("res_batch_12");
  });
});
