/**
 * 予約へのメッセージの保存（ReservationMessageRepository）を、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 押さえるのは、列が INFO-004 どおりに入ること、通知が outbox に積まれること、
 * 予約の updated_at を変えないこと（予約の楽観ロックをメッセージの送信で壊さない）の 3 つ。
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { MailDraft } from "~/domain/mail/mail-outbox";
import { ReservationStatus } from "~/domain/reservation";
import type { ReservationMessage } from "~/domain/reservation/message";

import { useD1TestDb } from "../d1-test-db";

/*
 * メッセージと通知メールの outbox は同じ `db.batch()` で書く（ADR-002）。ここでは本物の D1 の batch を通るので、
 * どちらかが失敗すれば両方とも巻き戻る、という本番と同じ振る舞いの上で確かめている。
 */
const testDb = useD1TestDb();
import { createReservationMessageRepository } from "./reservation-message-repo";

const initialUpdatedAt = 100000;

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_sender",
      "送信者",
      "sender@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_test",
      "テストグループ",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "facility" (id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "fac_test",
      "施設",
      1,
      0,
      0,
    ],
    [
      `INSERT INTO "reservation" (id, group_id, facility_id, start_at, end_at, head_count, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
    ],
  );
});
describe("createReservationMessageRepository を D1 で実行する", () => {
  it("メッセージの行が INFO-004 の列どおりに入り、メールが outbox に積まれ、enqueuedMailIds が返り、予約の updated_at が変わらない", async () => {
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

    const result = await createReservationMessageRepository(testDb.db).create(message, mails);

    expect(result.isOk()).toBe(true);
    const outcome = result._unsafeUnwrap();
    expect(outcome.enqueuedMailIds).toHaveLength(1);
    const enqueuedId = outcome.enqueuedMailIds[0]!;

    // 1. メッセージの行が INFO-004 の列どおりに入る
    const messageRow = await testDb.d1
      .prepare(`SELECT * FROM "reservation_message" WHERE id = ?`)
      .bind("msg_test_01")
      .first<{
        id: string;
        reservation_id: string;
        sender_id: string;
        sent_as_staff: number;
        body: string;
        sent_at: number;
      }>();

    expect(messageRow).not.toBeNull();
    expect(messageRow!.id).toBe("msg_test_01");
    expect(messageRow!.reservation_id).toBe("res_target");
    expect(messageRow!.sender_id).toBe("usr_sender");
    expect(messageRow!.sent_as_staff).toBe(0); // boolean false -> 0
    expect(messageRow!.body).toBe("利用人数の変更をお願いします。");
    expect(messageRow!.sent_at).toBe(sentAt.getTime());

    // 2. メールが outbox に積まれている
    const outboxRow = await testDb.d1
      .prepare(`SELECT * FROM "mail_outbox" WHERE id = ?`)
      .bind(enqueuedId)
      .first<{
        id: string;
        idempotency_key: string;
        to_address: string;
        to_name: string;
        subject: string;
        body_text: string;
        status: string;
      }>();

    expect(outboxRow).not.toBeNull();
    expect(outboxRow!.idempotency_key).toBe("reservation-message:msg_test_01:staff@osaka-u.ac.jp");
    expect(outboxRow!.to_address).toBe("staff@osaka-u.ac.jp");
    expect(outboxRow!.to_name).toBe("事務局");
    expect(outboxRow!.subject).toBe("【i-Club予約システム】予約にメッセージが届きました");
    expect(outboxRow!.body_text).toBe("メッセージ本文テスト");
    expect(outboxRow!.status).toBe("pending");

    // 3. 予約の updated_at が変わらない
    const reservationRow = await testDb.d1
      .prepare(`SELECT updated_at FROM "reservation" WHERE id = ?`)
      .bind("res_target")
      .first<{ updated_at: number }>();

    expect(reservationRow!.updated_at).toBe(initialUpdatedAt);
  });

  it("メールが無い場合もメッセージのみ保存され、enqueuedMailIds は空配列となる", async () => {
    const sentAt = new Date("2026-10-05T15:30:00+09:00");
    const message: ReservationMessage = {
      id: "msg_test_02",
      reservationId: "res_target",
      senderId: "usr_sender",
      sentAsStaff: true,
      body: "事務局からの連絡です。",
      sentAt,
    };

    const result = await createReservationMessageRepository(testDb.db).create(message, []);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().enqueuedMailIds).toEqual([]);

    const messageRow = await testDb.d1
      .prepare(`SELECT * FROM "reservation_message" WHERE id = ?`)
      .bind("msg_test_02")
      .first<{
        id: string;
        sent_as_staff: number;
      }>();
    expect(messageRow).not.toBeNull();
    expect(messageRow!.sent_as_staff).toBe(1); // boolean true -> 1
  });
});
