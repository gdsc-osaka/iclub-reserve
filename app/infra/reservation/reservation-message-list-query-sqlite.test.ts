/**
 * 予約メッセージ一覧（ReservationMessageListQuery）の問い合わせを、本物の SQLite に対して実行して確かめるテスト。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { ReservationStatus } from "~/domain/reservation";
import type { Database } from "../db";
import { createReservationMessageListQuery } from "./reservation-message-list-query";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

const USER_MEMBER = {
  userId: "usr_member",
  address: "member@ecs.osaka-u.ac.jp",
  name: "メンバー花子",
};
const USER_STAFF = { userId: "usr_staff", address: "staff@osaka-u.ac.jp", name: "スタッフ太郎" };

const createTestDb = () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") sqlite.exec(statement.trim());
    }
  }

  insertUser(sqlite, USER_MEMBER, { isStaff: false });
  insertUser(sqlite, USER_STAFF, { isStaff: true });

  sqlite
    .prepare(`INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run("grp_robotics", "ロボット部", "enabled", 0, 0);
  sqlite
    .prepare(
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
    )
    .run("fac_a", "会議室 A", 1, 0, 0);

  insertReservation(sqlite, "res_target");
  insertReservation(sqlite, "res_other");

  const db = drizzle(sqlite, { schema }) as unknown as Database;
  return { sqlite, query: createReservationMessageListQuery(db) };
};

function insertUser(
  sqlite: BetterSqlite3.Database,
  person: { userId: string; address: string; name: string },
  options: { isStaff: boolean },
) {
  sqlite
    .prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(person.userId, person.name, person.address, 1, 0, 0, options.isStaff ? 1 : 0);
}

function insertReservation(sqlite: BetterSqlite3.Database, reservationId: string) {
  sqlite
    .prepare(
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
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
    );
}

function insertMessage(
  sqlite: BetterSqlite3.Database,
  message: {
    id: string;
    reservationId: string;
    senderId: string;
    sentAsStaff: boolean;
    body: string;
    sentAt: Date;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO "reservation_message" (id, reservation_id, sender_id, sent_as_staff, body, sent_at) VALUES (?,?,?,?,?,?)`,
    )
    .run(
      message.id,
      message.reservationId,
      message.senderId,
      message.sentAsStaff ? 1 : 0,
      message.body,
      message.sentAt.getTime(),
    );
}

describe("createReservationMessageListQuery (SQLite)", () => {
  it("送った順に返り、同じ sent_at なら ID の昇順", async () => {
    const { sqlite, query } = createTestDb();

    const t1 = new Date("2026-10-01T10:00:00Z");
    const t2 = new Date("2026-10-01T11:00:00Z");

    insertMessage(sqlite, {
      id: "msg_03",
      reservationId: "res_target",
      senderId: USER_STAFF.userId,
      sentAsStaff: true,
      body: "3番目のメッセージ（同時刻でID大）",
      sentAt: t2,
    });
    insertMessage(sqlite, {
      id: "msg_01",
      reservationId: "res_target",
      senderId: USER_MEMBER.userId,
      sentAsStaff: false,
      body: "1番目のメッセージ",
      sentAt: t1,
    });
    insertMessage(sqlite, {
      id: "msg_02",
      reservationId: "res_target",
      senderId: USER_MEMBER.userId,
      sentAsStaff: false,
      body: "2番目のメッセージ（同時刻でID小）",
      sentAt: t2,
    });

    const result = await query.listByReservationId("res_target");
    expect(result.isOk()).toBe(true);
    const messages = result._unsafeUnwrap();

    expect(messages.map((m) => m.id)).toEqual(["msg_01", "msg_02", "msg_03"]);
  });

  it("他の予約のメッセージは入らない", async () => {
    const { sqlite, query } = createTestDb();

    insertMessage(sqlite, {
      id: "msg_target",
      reservationId: "res_target",
      senderId: USER_MEMBER.userId,
      sentAsStaff: false,
      body: "対象のメッセージ",
      sentAt: new Date("2026-10-01T10:00:00Z"),
    });
    insertMessage(sqlite, {
      id: "msg_other",
      reservationId: "res_other",
      senderId: USER_MEMBER.userId,
      sentAsStaff: false,
      body: "他予約のメッセージ",
      sentAt: new Date("2026-10-01T10:00:00Z"),
    });

    const result = await query.listByReservationId("res_target");
    expect(result.isOk()).toBe(true);
    const messages = result._unsafeUnwrap();

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg_target");
  });

  it("senderName に送信者の氏名、sentAsStaff が boolean で返る", async () => {
    const { sqlite, query } = createTestDb();

    const sentAt = new Date("2026-10-01T10:00:00Z");
    insertMessage(sqlite, {
      id: "msg_staff",
      reservationId: "res_target",
      senderId: USER_STAFF.userId,
      sentAsStaff: true,
      body: "事務局からのメッセージ",
      sentAt,
    });
    insertMessage(sqlite, {
      id: "msg_member",
      reservationId: "res_target",
      senderId: USER_MEMBER.userId,
      sentAsStaff: false,
      body: "メンバーからのメッセージ",
      sentAt: new Date("2026-10-01T10:01:00Z"),
    });

    const result = await query.listByReservationId("res_target");
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
    const { query } = createTestDb();

    const result = await query.listByReservationId("res_target");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });
});
