/**
 * 予約の通知先（ReservationMailRecipientsQuery）の問い合わせを、本物の SQLite に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは通知先の取得を偽物に差し替えるので、問い合わせの条件の誤りは素通りする。
 * ここでは「申請者は、いまも自団体のメンバーか事務局である場合に限って宛先に入れる」（COND-008 の (1)）
 * という条件を、実際の DB で押さえる。
 *
 * この条件が無かった時期は、申請者を予約の created_by から引くだけだったので、
 * 団体から外された元メンバーや、事務局権限を剥奪された人にも、
 * 理由（status_reason）を載せた却下・キャンセルの通知が届いていた。
 *
 * マイグレーションをそのまま流す理由は `invitation-accept-sqlite.test.ts` と同じ。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type { Database } from "../db";
import { createReservationMailRecipientsQuery } from "./reservation-mail-recipients-query";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

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
const createTestDb = () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit は文の区切りにこの印を入れる
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") sqlite.exec(statement.trim());
    }
  }

  insertUser(sqlite, ADMIN, { isStaff: false });
  insertUser(sqlite, STAFF, { isStaff: true });
  sqlite
    .prepare(`INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run("grp_robotics", "ロボット部", "enabled", 0, 0);
  sqlite
    .prepare(
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
    )
    .run("fac_a", "会議室 A", 1, 0, 0);
  insertMember(sqlite, ADMIN.userId, MembershipRole.Admin);

  /*
   * better-sqlite3 版の Drizzle には `db.batch()` が無いので、D1 の代わりに渡した順で結果を返すものを足す。
   * D1 の batch は 1 行を「列名 → 値」のオブジェクトで受け取るので、同じ名前の列が 2 つあると
   * 1 つに潰れて後ろの列がずれる。better-sqlite3 ではこれが起きないため、列名が重なる文を渡されたら
   * ここで失敗させる（`audit-log-search-sqlite.test.ts` と同じ）。
   */
  const batch = (queries: readonly (PromiseLike<unknown> & { toSQL(): { sql: string } })[]) => {
    for (const query of queries) {
      const names = sqlite
        .prepare(query.toSQL().sql)
        .columns()
        .map((column) => column.name);
      if (new Set(names).size !== names.length) {
        throw new Error(`同じ名前の列があり、D1 の batch では列がずれる: ${names.join(", ")}`);
      }
    }
    return Promise.all(queries);
  };
  // 型は D1 版に合わせる。better-sqlite3 版も同じ問い合わせを組み立て、await で結果を返す
  const db = Object.assign(drizzle(sqlite, { schema }), { batch }) as unknown as Database;
  return { sqlite, query: createReservationMailRecipientsQuery(db) };
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

function insertMember(sqlite: BetterSqlite3.Database, userId: string, role: MembershipRole) {
  sqlite
    .prepare(
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    )
    .run(`mem_${userId}`, "grp_robotics", userId, role, 0, 0);
}

/** ロボット部の予約を、申請者が申請したものとして入れる */
const insertReservation = (sqlite: BetterSqlite3.Database) =>
  sqlite
    .prepare(
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
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
    );

describe("findByReservationId を SQLite で実行する（申請者を宛先に入れる条件。COND-008 の (1)）", () => {
  it("自団体のメンバーである申請者は、団体側の宛先に入る", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: false });
    insertMember(sqlite, APPLICANT.userId, MembershipRole.Member);
    insertReservation(sqlite);

    const result = await query.findByReservationId("res_target");

    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN, APPLICANT], staff: [STAFF] });
  });

  it("団体から外された元メンバー（UC-011）は、宛先に入らない", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: false });
    insertMember(sqlite, APPLICANT.userId, MembershipRole.Member);
    insertReservation(sqlite);
    // 申請した後で、管理者が団体から外した
    sqlite.prepare(`DELETE FROM "group_member" WHERE user_id = ?`).run(APPLICANT.userId);

    const result = await query.findByReservationId("res_target");

    // 申請者が宛先に入らなくても、予約が無いとは扱わない（管理者と事務局には届ける）
    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN], staff: [STAFF] });
  });

  it("他団体の予約を代わりに申請した後で事務局権限を剥奪された人（UC-028）は、宛先に入らない", async () => {
    const { sqlite, query } = createTestDb();
    // 事務局として、所属していないロボット部の予約を申請した
    insertUser(sqlite, APPLICANT, { isStaff: true });
    insertReservation(sqlite);
    // その後で事務局権限を剥奪された
    sqlite.prepare(`UPDATE "user" SET is_staff = 0 WHERE id = ?`).run(APPLICANT.userId);

    const result = await query.findByReservationId("res_target");

    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN], staff: [STAFF] });
  });

  it("他団体の予約を代わりに申請した事務局は、権限が残っていれば団体側の宛先に入る", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: true });
    insertReservation(sqlite);

    const result = await query.findByReservationId("res_target");

    // 申請者として団体側に入れ、事務局の宛先からは重複を除く
    expect(result._unsafeUnwrap()).toEqual({ groupMembers: [ADMIN, APPLICANT], staff: [STAFF] });
  });
});

function insertMessage(
  sqlite: BetterSqlite3.Database,
  message: {
    id: string;
    reservationId: string;
    senderId: string;
    sentAsStaff: boolean;
    body: string;
    sentAt: number;
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
      message.sentAt,
    );
}

describe("findForMessage を SQLite で実行する（メッセージ通知先の取得条件。EVT-008）", () => {
  it("申請者は、団体から外れていて事務局でもなければ groupMembers に入らない", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: false });
    insertMember(sqlite, APPLICANT.userId, MembershipRole.Member);
    insertReservation(sqlite);
    // 申請者を団体から外す
    sqlite.prepare(`DELETE FROM "group_member" WHERE user_id = ?`).run(APPLICANT.userId);

    const result = await query.findForMessage("res_target");

    expect(result.isOk()).toBe(true);
    const audience = result._unsafeUnwrap();
    expect(audience.groupMembers).toEqual([ADMIN]);
  });

  it("staff は groupMembers と重複しても除かれない", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: false });
    insertReservation(sqlite);
    // 事務局員を団体管理者としても登録
    insertMember(sqlite, STAFF.userId, MembershipRole.Admin);

    const result = await query.findForMessage("res_target");

    expect(result.isOk()).toBe(true);
    const audience = result._unsafeUnwrap();
    // 団体側にも事務局側にも STAFF が残る
    expect(audience.groupMembers).toEqual([ADMIN, STAFF]);
    expect(audience.staff).toEqual([STAFF]);
  });

  it("priorGroupSideSenders は sent_as_staff = false の送信者のみが入り、重複せず、他予約や団体から外れた者は除かれる", async () => {
    const { sqlite, query } = createTestDb();
    insertUser(sqlite, APPLICANT, { isStaff: false });
    insertReservation(sqlite);

    // 別の予約を作成
    sqlite
      .prepare(
        `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
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
      );

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

    insertUser(sqlite, SENDER_VALID, { isStaff: false });
    insertMember(sqlite, SENDER_VALID.userId, MembershipRole.Member);

    insertUser(sqlite, SENDER_REMOVED, { isStaff: false });
    // 脱退済み（メンバーシップなし）

    insertUser(sqlite, SENDER_OTHER_RES, { isStaff: false });
    insertMember(sqlite, SENDER_OTHER_RES.userId, MembershipRole.Member);

    // 1. sent_as_staff = false の正常なメッセージ送信（複数回送信しても1人）
    insertMessage(sqlite, {
      id: "msg_1",
      reservationId: "res_target",
      senderId: SENDER_VALID.userId,
      sentAsStaff: false,
      body: "メッセージ1",
      sentAt: 100,
    });
    insertMessage(sqlite, {
      id: "msg_2",
      reservationId: "res_target",
      senderId: SENDER_VALID.userId,
      sentAsStaff: false,
      body: "メッセージ2",
      sentAt: 200,
    });

    // 2. sent_as_staff = true の事務局送信（priorGroupSideSenders に入らない）
    insertMessage(sqlite, {
      id: "msg_3",
      reservationId: "res_target",
      senderId: STAFF.userId,
      sentAsStaff: true,
      body: "事務局からの返信",
      sentAt: 300,
    });

    // 3. 脱退した元メンバーの過去送信（入らない）
    insertMessage(sqlite, {
      id: "msg_4",
      reservationId: "res_target",
      senderId: SENDER_REMOVED.userId,
      sentAsStaff: false,
      body: "脱退者のメッセージ",
      sentAt: 400,
    });

    // 4. 別の予約に対する送信（入らない）
    insertMessage(sqlite, {
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
    const { query } = createTestDb();
    const result = await query.findForMessage("non_existent_res");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });
});
