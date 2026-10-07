/**
 * 予約の通知先（ReservationMailRecipientsQuery）の問い合わせを、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは通知先の取得を偽物に差し替えるので、問い合わせの条件の誤りは素通りする。
 * ここでは「申請者は、いまも自団体のメンバーか事務局である場合に限って宛先に入れる」（COND-008 の (1)）
 * という条件を、実際の DB で押さえる。
 *
 * この条件が無かった時期は、申請者を予約の created_by から引くだけだったので、
 * 団体から外された元メンバーや、事務局権限を剥奪された人にも、
 * 理由（status_reason）を載せた却下・キャンセルの通知が届いていた。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useD1TestDb } from "../d1-test-db";

import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import { createReservationMailRecipientsQuery } from "./reservation-mail-recipients-query";

/** 宛先として返ってくる形。期待値を書きやすくするためにまとめておく */
const ADMIN = { userId: "usr_admin", address: "admin@ecs.osaka-u.ac.jp", name: "管理者" };
const APPLICANT = {
  userId: "usr_applicant",
  address: "applicant@ecs.osaka-u.ac.jp",
  name: "申請者",
};
const STAFF = { userId: "usr_staff", address: "staff@osaka-u.ac.jp", name: "事務局" };

/**
 * マイグレーションを流し、団体・施設と、管理者・事務局を入れた DB を作る。
 * 申請者はテストごとに所属や事務局権限が違うので、ここでは入れない。
 */
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
      ADMIN.userId,
      ADMIN.name,
      ADMIN.address,
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      STAFF.userId,
      STAFF.name,
      STAFF.address,
      1,
      0,
      0,
      1,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_robotics",
      "ロボット部",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_a",
      "会議室 A",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      `mem_${ADMIN.userId}`,
      "grp_robotics",
      ADMIN.userId,
      "admin",
      0,
      0,
    ],
  );
});

async function insertUser(
  person: { userId: string; address: string; name: string },
  options: { isStaff: boolean },
) {
  await testDb.seed([
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    person.userId,
    person.name,
    person.address,
    1,
    0,
    0,
    options.isStaff ? 1 : 0,
  ]);
}

async function insertMember(userId: string, role: MembershipRole) {
  await testDb.seed([
    `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    `mem_${userId}`,
    "grp_robotics",
    userId,
    role,
    0,
    0,
  ]);
}

/** ロボット部の予約を、申請者が申請したものとして入れる */
const insertReservation = async () =>
  await testDb.seed([
    `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    "res_target",
    "grp_robotics",
    "fac_a",
    new Date("2026-10-10T10:00:00+09:00").getTime(),
    new Date("2026-10-10T12:00:00+09:00").getTime(),
    4,
    ReservationStatus.Provisional,
    APPLICANT.userId,
    0,
    0,
  ]);

describe("findByReservationId を D1 で実行する（申請者を宛先に入れる条件。COND-008 の (1)）", () => {
  it("自団体のメンバーである申請者は、団体側の宛先に入る", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: false });
    await insertMember(APPLICANT.userId, MembershipRole.Member);
    await insertReservation();

    const result = await query.findByReservationId("res_target");

    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN, APPLICANT], staff: [STAFF] });
  });

  it("団体から外された元メンバー（UC-011）は、宛先に入らない", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: false });
    await insertMember(APPLICANT.userId, MembershipRole.Member);
    await insertReservation();
    // 申請した後で、管理者が団体から外した
    await testDb.seed([`DELETE FROM "group_member" WHERE user_id = ?`, APPLICANT.userId]);

    const result = await query.findByReservationId("res_target");

    // 申請者が宛先に入らなくても、予約が無いとは扱わない（管理者と事務局には届ける）
    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN], staff: [STAFF] });
  });

  it("他団体の予約を代わりに申請した後で事務局権限を剥奪された人（UC-028）は、宛先に入らない", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    // 事務局として、所属していないロボット部の予約を申請した
    await insertUser(APPLICANT, { isStaff: true });
    await insertReservation();
    // その後で事務局権限を剥奪された
    await testDb.seed([`UPDATE "user" SET is_staff = 0 WHERE id = ?`, APPLICANT.userId]);

    const result = await query.findByReservationId("res_target");

    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN], staff: [STAFF] });
  });

  it("他団体の予約を代わりに申請した事務局は、権限が残っていれば団体側の宛先に入る", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: true });
    await insertReservation();

    const result = await query.findByReservationId("res_target");

    // 申請者として団体側に入れ、事務局の宛先からは重複を除く
    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN, APPLICANT], staff: [STAFF] });
  });
});

async function insertMessage(message: {
  id: string;
  reservationId: string;
  senderId: string;
  sentAsStaff: boolean;
  body: string;
  sentAt: number;
}) {
  await testDb.seed([
    `INSERT INTO "reservation_message" (id, reservation_id, sender_id, sent_as_staff, body, sent_at) VALUES (?,?,?,?,?,?)`,
    message.id,
    message.reservationId,
    message.senderId,
    message.sentAsStaff ? 1 : 0,
    message.body,
    message.sentAt,
  ]);
}

describe("findForMessage を D1 で実行する（メッセージ通知先の取得条件。EVT-008）", () => {
  it("申請者は、団体から外れていて事務局でもなければ groupMembers に入らない", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: false });
    await insertMember(APPLICANT.userId, MembershipRole.Member);
    await insertReservation();
    // 申請者を団体から外す
    await testDb.seed([`DELETE FROM "group_member" WHERE user_id = ?`, APPLICANT.userId]);

    const result = await query.findForMessage("res_target");

    expect(result.isOk()).toBe(true);
    const audience = result._unsafeUnwrap();
    expect(audience.groupMembers).toEqual([ADMIN]);
  });

  it("staff は groupMembers と重複しても除かれない", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: false });
    await insertReservation();
    // 事務局員を団体管理者としても登録
    await insertMember(STAFF.userId, MembershipRole.Admin);

    const result = await query.findForMessage("res_target");

    expect(result.isOk()).toBe(true);
    const audience = result._unsafeUnwrap();
    // 団体側にも事務局側にも STAFF が残る
    expect(audience.groupMembers).toEqual([ADMIN, STAFF]);
    expect(audience.staff).toEqual([STAFF]);
  });

  it("priorGroupSideSenders は sent_as_staff = false の送信者のみが入り、重複せず、他予約や団体から外れた者は除かれる", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    await insertUser(APPLICANT, { isStaff: false });
    await insertReservation();

    // 別の予約を作成
    await testDb.seed([
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "res_other",
      "grp_robotics",
      "fac_a",
      new Date("2026-10-11T10:00:00+09:00").getTime(),
      new Date("2026-10-11T12:00:00+09:00").getTime(),
      2,
      ReservationStatus.Approved,
      ADMIN.userId,
      0,
      0,
    ]);

    const SENDER_VALID = {
      userId: "usr_sender_valid",
      address: "sender_valid@ecs.osaka-u.ac.jp",
      name: "有効送信者",
    };
    const SENDER_REMOVED = {
      userId: "usr_sender_removed",
      address: "sender_removed@ecs.osaka-u.ac.jp",
      name: "脱退送信者",
    };
    const SENDER_OTHER_RES = {
      userId: "usr_sender_other",
      address: "sender_other@ecs.osaka-u.ac.jp",
      name: "他予約送信者",
    };

    await insertUser(SENDER_VALID, { isStaff: false });
    await insertMember(SENDER_VALID.userId, MembershipRole.Member);

    await insertUser(SENDER_REMOVED, { isStaff: false });
    // 脱退済み（メンバーシップなし）

    await insertUser(SENDER_OTHER_RES, { isStaff: false });
    await insertMember(SENDER_OTHER_RES.userId, MembershipRole.Member);

    // 1. sent_as_staff = false の正常なメッセージ送信（複数回送信しても1人）
    await insertMessage({
      id: "msg_1",
      reservationId: "res_target",
      senderId: SENDER_VALID.userId,
      sentAsStaff: false,
      body: "メッセージ1",
      sentAt: 100,
    });
    await insertMessage({
      id: "msg_2",
      reservationId: "res_target",
      senderId: SENDER_VALID.userId,
      sentAsStaff: false,
      body: "メッセージ2",
      sentAt: 200,
    });

    // 2. sent_as_staff = true の事務局送信（priorGroupSideSenders に入らない）
    await insertMessage({
      id: "msg_3",
      reservationId: "res_target",
      senderId: STAFF.userId,
      sentAsStaff: true,
      body: "事務局からの返信",
      sentAt: 300,
    });

    // 3. 脱退した元メンバーの過去送信（入らない）
    await insertMessage({
      id: "msg_4",
      reservationId: "res_target",
      senderId: SENDER_REMOVED.userId,
      sentAsStaff: false,
      body: "脱退者のメッセージ",
      sentAt: 400,
    });

    // 4. 別の予約に対する送信（入らない）
    await insertMessage({
      id: "msg_5",
      reservationId: "res_other",
      senderId: SENDER_OTHER_RES.userId,
      sentAsStaff: false,
      body: "別予約のメッセージ",
      sentAt: 500,
    });

    const result = await query.findForMessage("res_target");

    expect(result.isOk()).toBe(true);
    const audience = result._unsafeUnwrap();
    expect(audience.priorGroupSideSenders).toEqual([SENDER_VALID]);
  });

  it("予約が存在しない場合は NotFound となる", async () => {
    const query = createReservationMailRecipientsQuery(testDb.db);
    const result = await query.findForMessage("non_existent_res");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });
});
