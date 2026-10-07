/**
 * 予約メッセージ一覧（ReservationMessageListQuery）の問い合わせを、ローカルの本物の D1 に対して実行して確かめるテスト。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { ReservationStatus } from "~/domain/reservation";

import { useD1TestDb } from "../d1-test-db";

const testDb = useD1TestDb();
import { createReservationMessageListQuery } from "./reservation-message-list-query";

const USER_MEMBER = {
  userId: "usr_member",
  address: "member@ecs.osaka-u.ac.jp",
  name: "メンバー花子",
};
const USER_STAFF = { userId: "usr_staff", address: "staff@osaka-u.ac.jp", name: "スタッフ太郎" };

beforeEach(async () => {
  await testDb.seed(
    insertUser(USER_MEMBER, { isStaff: false }),
    insertUser(USER_STAFF, { isStaff: true }),
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_robotics",
      "ロボティクス",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_a",
      "施設 A",
      1,
      0,
      0,
    ],
    insertReservation("res_target"),
    insertReservation("res_other"),
  );
});
const insertUser = (
  person: { userId: string; address: string; name: string },
  options: { isStaff: boolean },
) =>
  [
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    person.userId,
    person.name,
    person.address,
    1,
    0,
    0,
    options.isStaff ? 1 : 0,
  ] as const;

const insertReservation = (reservationId: string) =>
  [
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,

    reservationId,
    "grp_robotics",
    "fac_a",
    new Date("2026-10-10T10:00:00+09:00").getTime(),
    new Date("2026-10-10T12:00:00+09:00").getTime(),
    4,
    ReservationStatus.Provisional,
    USER_MEMBER.userId,
    0,
    0,
  ] as const;

const insertMessage = (message: {
  id: string;
  reservationId: string;
  senderId: string;
  sentAsStaff: boolean;
  body: string;
  sentAt: Date;
}) =>
  [
    `INSERT INTO "reservation_message" (id, reservation_id, sender_id, sent_as_staff, body, sent_at) VALUES (?,?,?,?,?,?)`,

    message.id,
    message.reservationId,
    message.senderId,
    message.sentAsStaff ? 1 : 0,
    message.body,
    message.sentAt.getTime(),
  ] as const;

describe("createReservationMessageListQuery (D1)", () => {
  it("送った順に返り、同じ sent_at なら ID の昇順", async () => {
    const t1 = new Date("2026-10-01T10:00:00Z");
    const t2 = new Date("2026-10-01T11:00:00Z");

    await testDb.seed(
      insertMessage({
        id: "msg_03",
        reservationId: "res_target",
        senderId: USER_STAFF.userId,
        sentAsStaff: true,
        body: "3番目のメッセージ（同時刻でID大）",
        sentAt: t2,
      }),
    );
    await testDb.seed(
      insertMessage({
        id: "msg_01",
        reservationId: "res_target",
        senderId: USER_MEMBER.userId,
        sentAsStaff: false,
        body: "1番目のメッセージ",
        sentAt: t1,
      }),
    );
    await testDb.seed(
      insertMessage({
        id: "msg_02",
        reservationId: "res_target",
        senderId: USER_MEMBER.userId,
        sentAsStaff: false,
        body: "2番目のメッセージ（同時刻でID小）",
        sentAt: t2,
      }),
    );

    const result = await createReservationMessageListQuery(testDb.db).listByReservationId(
      "res_target",
    );
    expect(result.isOk()).toBe(true);
    const messages = result._unsafeUnwrap();

    expect(messages.map((m) => m.id)).toEqual(["msg_01", "msg_02", "msg_03"]);
  });

  it("他の予約のメッセージは入らない", async () => {
    await testDb.seed(
      insertMessage({
        id: "msg_target",
        reservationId: "res_target",
        senderId: USER_MEMBER.userId,
        sentAsStaff: false,
        body: "対象のメッセージ",
        sentAt: new Date("2026-10-01T10:00:00Z"),
      }),
    );
    await testDb.seed(
      insertMessage({
        id: "msg_other",
        reservationId: "res_other",
        senderId: USER_MEMBER.userId,
        sentAsStaff: false,
        body: "他予約のメッセージ",
        sentAt: new Date("2026-10-01T10:00:00Z"),
      }),
    );

    const result = await createReservationMessageListQuery(testDb.db).listByReservationId(
      "res_target",
    );
    expect(result.isOk()).toBe(true);
    const messages = result._unsafeUnwrap();

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg_target");
  });

  it("senderName に送信者の氏名、sentAsStaff が boolean で返る", async () => {
    const sentAt = new Date("2026-10-01T10:00:00Z");
    await testDb.seed(
      insertMessage({
        id: "msg_staff",
        reservationId: "res_target",
        senderId: USER_STAFF.userId,
        sentAsStaff: true,
        body: "事務局からのメッセージ",
        sentAt,
      }),
    );
    await testDb.seed(
      insertMessage({
        id: "msg_member",
        reservationId: "res_target",
        senderId: USER_MEMBER.userId,
        sentAsStaff: false,
        body: "メンバーからのメッセージ",
        sentAt: new Date("2026-10-01T10:01:00Z"),
      }),
    );

    const result = await createReservationMessageListQuery(testDb.db).listByReservationId(
      "res_target",
    );
    expect(result.isOk()).toBe(true);
    const messages = result._unsafeUnwrap();

    expect(messages[0]).toMatchObject({
      id: "msg_staff",
      senderId: USER_STAFF.userId,
      senderName: USER_STAFF.name,
      sentAsStaff: true,
      body: "事務局からのメッセージ",
      sentAt,
    });
    expect(typeof messages[0].sentAsStaff).toBe("boolean");

    expect(messages[1]).toMatchObject({
      id: "msg_member",
      senderId: USER_MEMBER.userId,
      senderName: USER_MEMBER.name,
      sentAsStaff: false,
      body: "メンバーからのメッセージ",
    });
    expect(typeof messages[1].sentAsStaff).toBe("boolean");
  });

  it("メッセージが無ければ空配列", async () => {
    const result = await createReservationMessageListQuery(testDb.db).listByReservationId(
      "res_target",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });
});
