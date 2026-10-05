/**
 * 予約へのメッセージの保存（ReservationMessageRepository）を、本物の SQLite に対して実行して確かめるテスト。
 *
 * 押さえるのは、列が INFO-004 どおりに入ること、通知が outbox に積まれること、
 * 予約の updated_at を変えないこと（予約の楽観ロックをメッセージの送信で壊さない）の 3 つ。
 *
 * マイグレーションをそのまま流す理由は `invitation-accept-sqlite.test.ts` と同じ。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { ReservationStatus } from "~/domain/reservation";
import type { ReservationMessage } from "~/domain/reservation/message";
import type { Database } from "../db";
import { createReservationMessageRepository } from "./reservation-message-repo";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

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

  // 初期データ投入
  sqlite
    .prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    )
    .run("usr_sender", "送信者", "sender@ecs.osaka-u.ac.jp", 1, 0, 0, 0);

  sqlite
    .prepare(`INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run("grp_test", "テスト部", "enabled", 0, 0);

  sqlite
    .prepare(
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
    )
    .run("fac_test", "会議室", 1, 0, 0);

  const initialUpdatedAt = 100000;
  sqlite
    .prepare(
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "res_target",
      "grp_test",
      "fac_test",
      200000,
      300000,
      4,
      ReservationStatus.Approved,
      "usr_sender",
      initialUpdatedAt,
      initialUpdatedAt,
    );

  /*
   * better-sqlite3 版の Drizzle には `db.batch()` が無いので、渡した文を順に流すだけのものを足す。
   * D1 の batch と違ってトランザクションにはならないため、メッセージとメールが不可分に書かれることは
   * ここでは確かめられない。不可分であることは、1 回の db.batch に入れているという書き方で担保している。
   */
  const batch = (queries: readonly PromiseLike<unknown>[]) => {
    return Promise.all(queries);
  };

  const db = Object.assign(drizzle(sqlite, { schema }), { batch }) as unknown as Database;
  return {
    sqlite,
    repo: createReservationMessageRepository(db),
    initialUpdatedAt,
  };
};

describe("createReservationMessageRepository を SQLite で実行する", () => {
  it("メッセージの行が INFO-004 の列どおりに入り、メールが outbox に積まれ、enqueuedMailIds が返り、予約の updated_at が変わらない", async () => {
    const { sqlite, repo, initialUpdatedAt } = createTestDb();

    const sentAt = new Date("2026-10-05T15:00:00+09:00");
    const message: ReservationMessage = {
      id: "msg_test_01",
      reservationId: "res_target",
      senderId: "usr_sender",
      sentAsStaff: false,
      body: "利用人数の変更をお願いします。",
      sentAt,
    };

    const mails: readonly MailDraft[] = [
      {
        idempotencyKey: "reservation-message:msg_test_01:staff@osaka-u.ac.jp",
        to: { address: "staff@osaka-u.ac.jp", name: "事務局" },
        subject: "【i-Club予約システム】予約にメッセージが届きました",
        text: "メッセージ本文テスト",
      },
    ];

    const result = await repo.create(message, mails);

    expect(result.isOk()).toBe(true);
    const outcome = result._unsafeUnwrap();
    expect(outcome.enqueuedMailIds).toHaveLength(1);
    const enqueuedId = outcome.enqueuedMailIds[0]!;

    // 1. メッセージの行が INFO-004 の列どおりに入る
    const messageRow = sqlite
      .prepare(`SELECT * FROM "reservation_message" WHERE id = ?`)
      .get("msg_test_01") as {
      id: string;
      reservation_id: string;
      sender_id: string;
      sent_as_staff: number;
      body: string;
      sent_at: number;
    };

    expect(messageRow).toBeDefined();
    expect(messageRow.id).toBe("msg_test_01");
    expect(messageRow.reservation_id).toBe("res_target");
    expect(messageRow.sender_id).toBe("usr_sender");
    expect(messageRow.sent_as_staff).toBe(0); // boolean false -> 0
    expect(messageRow.body).toBe("利用人数の変更をお願いします。");
    expect(messageRow.sent_at).toBe(sentAt.getTime());

    // 2. メールが outbox に積まれている
    const outboxRow = sqlite
      .prepare(`SELECT * FROM "mail_outbox" WHERE id = ?`)
      .get(enqueuedId) as {
      id: string;
      idempotency_key: string;
      to_address: string;
      to_name: string;
      subject: string;
      body_text: string;
      status: string;
    };

    expect(outboxRow).toBeDefined();
    expect(outboxRow.idempotency_key).toBe("reservation-message:msg_test_01:staff@osaka-u.ac.jp");
    expect(outboxRow.to_address).toBe("staff@osaka-u.ac.jp");
    expect(outboxRow.to_name).toBe("事務局");
    expect(outboxRow.subject).toBe("【i-Club予約システム】予約にメッセージが届きました");
    expect(outboxRow.body_text).toBe("メッセージ本文テスト");
    expect(outboxRow.status).toBe("pending");

    // 3. 予約の updated_at が変わらない
    const reservationRow = sqlite
      .prepare(`SELECT updated_at FROM "reservation" WHERE id = ?`)
      .get("res_target") as { updated_at: number };

    expect(reservationRow.updated_at).toBe(initialUpdatedAt);
  });

  it("メールが無い場合もメッセージのみ保存され、enqueuedMailIds は空配列となる", async () => {
    const { sqlite, repo } = createTestDb();

    const sentAt = new Date("2026-10-05T15:30:00+09:00");
    const message: ReservationMessage = {
      id: "msg_test_02",
      reservationId: "res_target",
      senderId: "usr_sender",
      sentAsStaff: true,
      body: "事務局からの連絡です。",
      sentAt,
    };

    const result = await repo.create(message, []);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().enqueuedMailIds).toEqual([]);

    const messageRow = sqlite
      .prepare(`SELECT * FROM "reservation_message" WHERE id = ?`)
      .get("msg_test_02") as {
      id: string;
      sent_as_staff: number;
    };
    expect(messageRow).toBeDefined();
    expect(messageRow.sent_as_staff).toBe(1); // boolean true -> 1
  });
});
