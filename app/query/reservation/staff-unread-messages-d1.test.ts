/**
 * 事務局側の未読（findStaffUnreadMessages）をローカル D1 に対して検証するテスト。
 *
 * COND-026 (3) の事務局側の各判定を検証する:
 * - 事務局でない人には Forbidden を返す
 * - 団体側のメッセージが未読になる
 * - 事務局の誰かが後から返信すると全員の未読から消える
 * - 事務局の誰かが後から承認などの操作をすると全員の未読から消える
 * - 開いた本人の分だけが既読になる（他の事務局には残る）
 * - 事務局が団体側として送ったものは、その本人には未読にならない
 * - 事務局が動いた後に届いたメッセージは未読に戻る
 * - 30 日より前のメッセージは出ない
 * - 予約 1 件につき 1 行にまとめ、最大 10 件で超えた分は件数だけ返す
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { QueryErrorCode } from "../error";
import { findStaffUnreadMessages } from "./staff-unread-messages";

const testDb = useD1TestDb();

const USER_MEMBER = { id: "usr_member", name: "一般部員", email: "member@example.com" };
const USER_STAFF_1 = { id: "usr_staff_1", name: "事務局 1", email: "staff1@example.com" };
const USER_STAFF_2 = { id: "usr_staff_2", name: "事務局 2", email: "staff2@example.com" };

const NOW = new Date("2026-10-20T12:00:00+09:00");

beforeEach(async () => {
  for (const u of [USER_MEMBER, USER_STAFF_1, USER_STAFF_2]) {
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      u.id,
      u.name,
      u.email,
      1,
      0,
      0,
      u.id.includes("staff") ? 1 : 0,
    ]);
  }

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
  await testDb.seed([
    `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    "mem_1",
    "grp_test",
    USER_MEMBER.id,
    MembershipRole.Member,
    0,
    0,
  ]);
});

async function insertReservation(
  id: string,
  createdBy: string = USER_MEMBER.id,
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
    "{}",
  ]);
}

async function insertRead(userId: string, reservationId: string, lastReadAt: Date) {
  await testDb.seed([
    `INSERT INTO "reservation_read" (user_id, reservation_id, last_read_at) VALUES (?,?,?)`,
    userId,
    reservationId,
    lastReadAt.getTime(),
  ]);
}

/** 事務局 `staffUserId` から見た、今の未読 */
const findUnreadFor = (staffUserId: string) =>
  findStaffUnreadMessages(testDb.db, { actorUserId: staffUserId, isStaff: true, now: NOW });

describe("findStaffUnreadMessages", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findStaffUnreadMessages(testDb.db, {
      actorUserId: USER_MEMBER.id,
      isStaff: false,
      now: NOW,
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("団体側がメッセージを送ると事務局の未読になる", async () => {
    await insertReservation("res_1");
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "こんにちは",
      new Date("2026-10-20T10:00:00+09:00"),
    );

    const result = await findUnreadFor(USER_STAFF_1.id);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.reservationId).toBe("res_1");
    expect(result.value.items[0]?.latestMessage.body).toBe("こんにちは");
    expect(result.value.items[0]?.otherCount).toBe(0);
  });

  it("事務局の誰かが後から返信すると全員の未読から消える", async () => {
    await insertReservation("res_1");
    // 10:00 団体がメッセージ送信
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "質問です",
      new Date("2026-10-20T10:00:00+09:00"),
    );
    // 11:00 事務局2 が事務局として返信
    await insertMessage(
      "msg_2",
      "res_1",
      USER_STAFF_2.id,
      true,
      "回答です",
      new Date("2026-10-20T11:00:00+09:00"),
    );

    // 事務局1 から見ても未読から消えている
    const result1 = await findUnreadFor(USER_STAFF_1.id);
    expect(result1.isOk()).toBe(true);
    if (!result1.isOk()) return;
    expect(result1.value.items).toHaveLength(0);

    // 事務局2 から見ても消えている
    const result2 = await findUnreadFor(USER_STAFF_2.id);
    expect(result2.isOk()).toBe(true);
    if (!result2.isOk()) return;
    expect(result2.value.items).toHaveLength(0);
  });

  it("事務局の誰かが後から承認などの操作をすると全員の未読から消える", async () => {
    await insertReservation("res_1");
    // 10:00 団体がメッセージ送信
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "承認お願いします",
      new Date("2026-10-20T10:00:00+09:00"),
    );
    // 11:00 事務局2 が承認を実行（AuditLog に acted_as_staff = true で記録）
    await insertAuditLog(
      "log_1",
      "res_1",
      USER_STAFF_2.id,
      true,
      AuditLogAction.ReservationApprove,
      new Date("2026-10-20T11:00:00+09:00"),
    );

    const result = await findUnreadFor(USER_STAFF_1.id);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.items).toHaveLength(0);
  });

  it("開いた本人の分だけが既読になる（他の事務局には残る）", async () => {
    await insertReservation("res_1");
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "確認用メッセージ",
      new Date("2026-10-20T10:00:00+09:00"),
    );

    // 事務局1 だけが 10:30 に既読にした
    await insertRead(USER_STAFF_1.id, "res_1", new Date("2026-10-20T10:30:00+09:00"));

    // 事務局1 からは見えない
    const result1 = await findUnreadFor(USER_STAFF_1.id);
    expect(result1.isOk()).toBe(true);
    if (!result1.isOk()) return;
    expect(result1.value.items).toHaveLength(0);

    // 事務局2 からはまだ未読として見える
    const result2 = await findUnreadFor(USER_STAFF_2.id);
    expect(result2.isOk()).toBe(true);
    if (!result2.isOk()) return;
    expect(result2.value.items).toHaveLength(1);
    expect(result2.value.items[0]?.reservationId).toBe("res_1");
  });

  it("事務局が団体側として送ったものはその本人には未読にならない（他の事務局には未読になる）", async () => {
    await insertReservation("res_1");
    // 事務局1 が（自団体メンバーとして）団体側で送信（sent_as_staff = false）
    await insertMessage(
      "msg_1",
      "res_1",
      USER_STAFF_1.id,
      false,
      "事務局1が部員として送信",
      new Date("2026-10-20T10:00:00+09:00"),
    );

    // 送信者本人（事務局1）には未読にならない
    const result1 = await findUnreadFor(USER_STAFF_1.id);
    expect(result1.isOk()).toBe(true);
    if (!result1.isOk()) return;
    expect(result1.value.items).toHaveLength(0);

    // 別の事務局（事務局2）には未読になる
    const result2 = await findUnreadFor(USER_STAFF_2.id);
    expect(result2.isOk()).toBe(true);
    if (!result2.isOk()) return;
    expect(result2.value.items).toHaveLength(1);
    expect(result2.value.items[0]?.latestMessage.body).toBe("事務局1が部員として送信");
  });

  it("事務局が返信した後に届いた団体側のメッセージは未読になり、返信より前の分は数えない", async () => {
    await insertReservation("res_1");
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "1 通目",
      new Date("2026-10-20T09:00:00+09:00"),
    );
    await insertMessage(
      "msg_2",
      "res_1",
      USER_STAFF_2.id,
      true,
      "返信",
      new Date("2026-10-20T10:00:00+09:00"),
    );
    await insertMessage(
      "msg_3",
      "res_1",
      USER_MEMBER.id,
      false,
      "2 通目",
      new Date("2026-10-20T11:00:00+09:00"),
    );

    const value = (await findUnreadFor(USER_STAFF_1.id))._unsafeUnwrap();

    expect(value.items).toHaveLength(1);
    expect(value.items[0]?.latestMessage.body).toBe("2 通目");
    // 返信より前の 1 通目は既読とみなすので、「ほか n 件」に入れない
    expect(value.items[0]?.otherCount).toBe(0);
  });

  it("30 日より前のメッセージは、既読の記録が無くても出さない", async () => {
    await insertReservation("res_old");
    await insertReservation("res_recent");
    // NOW のちょうど 30 日前は範囲の外、それより後は範囲の中
    await insertMessage(
      "msg_old",
      "res_old",
      USER_MEMBER.id,
      false,
      "古い",
      new Date("2026-09-20T12:00:00+09:00"),
    );
    await insertMessage(
      "msg_recent",
      "res_recent",
      USER_MEMBER.id,
      false,
      "新しい",
      new Date("2026-09-20T12:01:00+09:00"),
    );

    const value = (await findUnreadFor(USER_STAFF_1.id))._unsafeUnwrap();

    expect(value.items.map((item) => item.reservationId)).toEqual(["res_recent"]);
  });

  it("同じ予約の未読は 1 行にまとめ、最新のメッセージを代表にして残りを数える", async () => {
    await insertReservation("res_1");
    await insertMessage(
      "msg_1",
      "res_1",
      USER_MEMBER.id,
      false,
      "1 通目",
      new Date("2026-10-20T09:00:00+09:00"),
    );
    await insertMessage(
      "msg_2",
      "res_1",
      USER_MEMBER.id,
      false,
      "2 通目",
      new Date("2026-10-20T10:00:00+09:00"),
    );
    await insertMessage(
      "msg_3",
      "res_1",
      USER_MEMBER.id,
      false,
      "3 通目",
      new Date("2026-10-20T11:00:00+09:00"),
    );

    const value = (await findUnreadFor(USER_STAFF_1.id))._unsafeUnwrap();

    expect(value.items).toHaveLength(1);
    expect(value.items[0]?.latestMessage.body).toBe("3 通目");
    expect(value.items[0]?.otherCount).toBe(2);
  });

  it("行は新しい順に最大 10 件で、超えた分は件数と ID だけを返す", async () => {
    // 12 件の予約に 1 通ずつ。res_00 がいちばん古く、res_11 がいちばん新しい
    const ids = Array.from({ length: 12 }, (_, i) => `res_${String(i).padStart(2, "0")}`);
    for (const [i, id] of ids.entries()) {
      await insertReservation(id);
      await insertMessage(
        `msg_${i}`,
        id,
        USER_MEMBER.id,
        false,
        `本文 ${i}`,
        new Date(Date.parse("2026-10-20T00:00:00+09:00") + i * 60_000),
      );
    }

    const value = (await findUnreadFor(USER_STAFF_1.id))._unsafeUnwrap();

    expect(value.items.map((item) => item.reservationId)).toEqual([...ids].reverse().slice(0, 10));
    expect(value.overflowCount).toBe(2);
    expect(value.allUnreadReservationIds).toHaveLength(12);
  });
});
