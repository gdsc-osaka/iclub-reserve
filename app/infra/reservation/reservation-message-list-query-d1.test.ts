/**
 * 予約メッセージ一覧（ReservationMessageListQuery）の問い合わせを、ローカルの本物の D1 に対して実行して確かめるテスト。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ReservationStatus } from "~/domain/reservation";

import { useD1TestDb } from "../d1-test-db";

import {
  seedFacility,
  seedGroup,
  seedReservation,
  seedReservationMessage,
  seedUser,
} from "../d1-test-seeds";
import { createReservationMessageListQuery } from "./reservation-message-list-query";

const testDb = useD1TestDb();

const USER_MEMBER = {
  userId: "usr_member",
  address: "member@ecs.osaka-u.ac.jp",
  name: "メンバー花子",
};
const USER_STAFF = { userId: "usr_staff", address: "staff@osaka-u.ac.jp", name: "スタッフ太郎" };

const insertUser = (
  person: { userId: string; address: string; name: string },
  options: { isStaff: boolean },
) =>
  seedUser({
    id: person.userId,
    name: person.name,
    email: person.address,
    is_staff: options.isStaff,
  });

const insertReservation = (reservationId: string) =>
  seedReservation({
    id: reservationId,
    groupId: "grp_robotics",
    facilityId: "fac_a",
    startAt: new Date("2026-10-10T10:00:00+09:00"),
    endAt: new Date("2026-10-10T12:00:00+09:00"),
    headCount: 4,
    status: ReservationStatus.Provisional,
    createdBy: USER_MEMBER.userId,
  });

const insertMessage = (message: {
  id: string;
  reservationId: string;
  senderId: string;
  sentAsStaff: boolean;
  body: string;
  sentAt: Date;
}) =>
  seedReservationMessage({
    id: message.id,
    reservationId: message.reservationId,
    senderId: message.senderId,
    sentAsStaff: message.sentAsStaff,
    body: message.body,
    sentAt: message.sentAt,
  });

beforeEach(async () => {
  await testDb.seed(
    insertUser(USER_MEMBER, { isStaff: false }),
    insertUser(USER_STAFF, { isStaff: true }),
    seedGroup({ id: "grp_robotics", name: "ロボティクス" }),
    seedFacility({ id: "fac_a", name: "施設 A" }),
    insertReservation("res_target"),
    insertReservation("res_other"),
  );
});

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
