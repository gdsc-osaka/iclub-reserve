import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { Database } from "../db";
import { createStaffInvitationRepository } from "./staff-invitation-repo";
import { createStaffManagementQuery } from "./staff-management-query";
import { createStaffMemberRepository } from "./staff-member-repo";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

/** マイグレーションを流したテスト用 DB を作る */
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

  /*
   * better-sqlite3 版の Drizzle には `db.batch()` が無いので、渡した文を順に流すだけのものを足す。
   * D1 の batch と違ってトランザクションにはならないため、招待とメールが不可分に書かれることは
   * ここでは確かめられない。不可分であることは、1 回の db.batch に入れているという書き方で担保している。
   */
  const batch = (queries: readonly PromiseLike<unknown>[]) => {
    return Promise.all(queries);
  };
  const db = Object.assign(drizzle(sqlite, { schema }), { batch }) as unknown as Database;

  return { sqlite, db };
};

describe("Staff Repositories & Query (SQLite)", () => {
  it("招待の行と outbox のメールが入り、enqueuedMailIds が返る", async () => {
    const { sqlite, db } = createTestDb();
    // 招待者を登録
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      )
      .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);

    const repo = createStaffInvitationRepository(db);

    const mailDraft: MailDraft = {
      idempotencyKey: "staff-invitation:created:inv_1:new@osaka-u.ac.jp",
      to: { address: "new@osaka-u.ac.jp" },
      subject: "テスト招待",
      text: "招待本文",
    };

    const result = await repo.create(
      {
        id: "inv_1",
        email: "new@osaka-u.ac.jp",
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        inviterId: "usr_staff_01",
        createdAt: new Date(),
      },
      [mailDraft],
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.enqueuedMailIds).toHaveLength(1);
    }

    const invitationRow = sqlite
      .prepare(`SELECT * FROM "staff_invitation" WHERE id = ?`)
      .get("inv_1") as { id: string; email: string; status: string } | undefined;
    expect(invitationRow).toBeDefined();
    expect(invitationRow?.email).toBe("new@osaka-u.ac.jp");
    expect(invitationRow?.status).toBe("pending");

    const outboxRow = sqlite
      .prepare(`SELECT * FROM "mail_outbox" WHERE idempotency_key = ?`)
      .get(mailDraft.idempotencyKey) as { id: string; to_address: string } | undefined;
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.to_address).toBe("new@osaka-u.ac.jp");
  });

  it("cancel は pending にしか効かない", async () => {
    const { sqlite, db } = createTestDb();
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      )
      .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);

    sqlite
      .prepare(
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      )
      .run("inv_pending", "p@osaka-u.ac.jp", "pending", 999999999, 0, "usr_staff_01");

    sqlite
      .prepare(
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      )
      .run("inv_canceled", "c@osaka-u.ac.jp", "canceled", 999999999, 0, "usr_staff_01");

    const repo = createStaffInvitationRepository(db);

    // pending のものは取り消せる
    const cancelPending = await repo.cancel("inv_pending");
    expect(cancelPending.isOk()).toBe(true);
    if (cancelPending.isOk()) {
      expect(cancelPending.value).toBe(1);
    }

    // すでに取り消されたものは 0 件
    const cancelCanceled = await repo.cancel("inv_canceled");
    expect(cancelCanceled.isOk()).toBe(true);
    if (cancelCanceled.isOk()) {
      expect(cancelCanceled.value).toBe(0);
    }

    // 存在しないものは 0 件
    const cancelNonExistent = await repo.cancel("inv_not_exist");
    expect(cancelNonExistent.isOk()).toBe(true);
    if (cancelNonExistent.isOk()) {
      expect(cancelNonExistent.value).toBe(0);
    }
  });

  it("revoke の条件: 事務局が 2 人のとき片方を剥奪すると 1 件、続けてもう片方を剥奪すると 0 件で is_staff が true のまま残る、事務局でない人は 0 件", async () => {
    const { sqlite, db } = createTestDb();
    const insertUser = sqlite.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    );
    insertUser.run("usr_staff_1", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_staff_2", "スタッフ2", "staff2@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_normal", "一般", "normal@osaka-u.ac.jp", 1, 0, 0, 0);

    const repo = createStaffMemberRepository(db);

    // 事務局が 2 人のとき、片方を剥奪すると 1 件
    const now = new Date("2026-10-05T12:00:00Z");
    const revoke1 = await repo.revoke("usr_staff_1", now);
    expect(revoke1.isOk()).toBe(true);
    if (revoke1.isOk()) {
      expect(revoke1.value).toBe(1);
    }

    // 剥奪されたことを確認
    const row1 = sqlite.prepare(`SELECT is_staff FROM "user" WHERE id = ?`).get("usr_staff_1") as {
      is_staff: number;
    };
    expect(row1.is_staff).toBe(0);

    // 続けてもう片方を剥奪すると 0 件（最後の事務局保護 COND-014）
    const revoke2 = await repo.revoke("usr_staff_2", now);
    expect(revoke2.isOk()).toBe(true);
    if (revoke2.isOk()) {
      expect(revoke2.value).toBe(0);
    }

    // is_staff が true のまま残る
    const row2 = sqlite.prepare(`SELECT is_staff FROM "user" WHERE id = ?`).get("usr_staff_2") as {
      is_staff: number;
    };
    expect(row2.is_staff).toBe(1);

    // 事務局でない人は 0 件
    const revokeNormal = await repo.revoke("usr_normal", now);
    expect(revokeNormal.isOk()).toBe(true);
    if (revokeNormal.isOk()) {
      expect(revokeNormal.value).toBe(0);
    }
  });

  it("事務局の検索: メールアドレスは大文字混じりで登録されていても一致し、事務局でない人は返さない", async () => {
    const { sqlite, db } = createTestDb();
    const insertUser = sqlite.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    );
    insertUser.run("usr_staff_1", "スタッフ1", "Staff.One@Osaka-U.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_staff_2", "スタッフ2", "staff2@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_normal", "一般", "normal@osaka-u.ac.jp", 1, 0, 0, 0);

    const repo = createStaffMemberRepository(db);

    // 引数は正規化済み（小文字）で渡ってくる
    expect((await repo.findStaffByEmail("staff.one@osaka-u.ac.jp"))._unsafeUnwrap()).toEqual({
      id: "usr_staff_1",
    });
    expect((await repo.findStaffByEmail("normal@osaka-u.ac.jp"))._unsafeUnwrap()).toBeNull();
    expect((await repo.findStaffByEmail("nobody@osaka-u.ac.jp"))._unsafeUnwrap()).toBeNull();

    expect((await repo.findStaffById("usr_staff_2"))._unsafeUnwrap()).toEqual({
      id: "usr_staff_2",
    });
    expect((await repo.findStaffById("usr_normal"))._unsafeUnwrap()).toBeNull();

    expect((await repo.countStaff())._unsafeUnwrap()).toBe(2);
  });

  it("findPendingByEmail は承諾待ちのうち期限が最も遅いものを返し、期限切れも返す", async () => {
    const { sqlite, db } = createTestDb();
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      )
      .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);

    const insertInv = sqlite.prepare(
      `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
    );
    insertInv.run("inv_old", "target@osaka-u.ac.jp", "pending", 1000, 0, "usr_staff_01");
    insertInv.run("inv_new", "target@osaka-u.ac.jp", "pending", 2000, 0, "usr_staff_01");
    // 取り消し済みは期限が遅くても対象外
    insertInv.run("inv_canceled", "target@osaka-u.ac.jp", "canceled", 3000, 0, "usr_staff_01");
    insertInv.run("inv_only_canceled", "gone@osaka-u.ac.jp", "canceled", 3000, 0, "usr_staff_01");

    const repo = createStaffInvitationRepository(db);

    // 期限（1000 / 2000 ミリ秒）はとうに過ぎているが、判定はユースケースに任せるので返す
    const found = (await repo.findPendingByEmail("target@osaka-u.ac.jp"))._unsafeUnwrap();
    expect(found?.id).toBe("inv_new");
    expect(found?.expiresAt.getTime()).toBe(2000);

    expect((await repo.findPendingByEmail("gone@osaka-u.ac.jp"))._unsafeUnwrap()).toBeNull();
  });

  it("読み取りモデルの並び順と pending の絞り込み", async () => {
    const { sqlite, db } = createTestDb();
    const insertUser = sqlite.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
    );
    // 氏名の昇順、同名は id の昇順
    insertUser.run("usr_b", "B 事務局", "b@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_a2", "A 事務局", "a2@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_a1", "A 事務局", "a1@osaka-u.ac.jp", 1, 0, 0, 1);
    insertUser.run("usr_normal", "一般 太郎", "normal@osaka-u.ac.jp", 1, 0, 0, 0); // 事務局でない

    const insertInv = sqlite.prepare(
      `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
    );
    // expires_at の昇順、同期限は id の昇順
    insertInv.run("inv_2", "two@osaka-u.ac.jp", "pending", 2000, 0, "usr_a1");
    insertInv.run("inv_1b", "one_b@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1");
    insertInv.run("inv_1a", "one_a@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1");
    insertInv.run("inv_canceled", "canceled@osaka-u.ac.jp", "canceled", 500, 0, "usr_a1"); // pending でない

    const query = createStaffManagementQuery(db);
    const result = await query.get();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { members, pendingInvitations } = result.value;

      // 事務局のみ、A 事務局(usr_a1) → A 事務局(usr_a2) → B 事務局(usr_b)
      expect(members).toHaveLength(3);
      expect(members[0].userId).toBe("usr_a1");
      expect(members[0].name).toBe("A 事務局");
      expect(members[1].userId).toBe("usr_a2");
      expect(members[2].userId).toBe("usr_b");

      // pending のみ、期限 1000(inv_1a) → 期限 1000(inv_1b) → 期限 2000(inv_2)
      expect(pendingInvitations).toHaveLength(3);
      expect(pendingInvitations[0].id).toBe("inv_1a");
      expect(pendingInvitations[1].id).toBe("inv_1b");
      expect(pendingInvitations[2].id).toBe("inv_2");
    }
  });

  it("findById は招待が存在すれば返し、存在しなければ null を返す", async () => {
    const { sqlite, db } = createTestDb();
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      )
      .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);

    sqlite
      .prepare(
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      )
      .run("inv_exists", "target@osaka-u.ac.jp", "pending", 5000, 1000, "usr_staff_01");

    const repo = createStaffInvitationRepository(db);

    const found = (await repo.findById("inv_exists"))._unsafeUnwrap();
    expect(found).not.toBeNull();
    expect(found?.id).toBe("inv_exists");
    expect(found?.email).toBe("target@osaka-u.ac.jp");
    expect(found?.status).toBe(InvitationStatus.Pending);

    const notFound = (await repo.findById("inv_not_exist"))._unsafeUnwrap();
    expect(notFound).toBeNull();
  });

  describe("accept (承諾)", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const validExpiresAt = new Date("2026-04-03T12:00:00.000Z");
    const expiredAt = new Date("2026-03-31T12:00:00.000Z");
    const targetEmail = "invitee@osaka-u.ac.jp";

    it("承諾で is_staff が true になり、招待が accepted になる", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_invitee", "招待された人", targetEmail, 1, 0, 0, 0);

      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run(
          "inv_valid",
          targetEmail,
          "pending",
          validExpiresAt.getTime(),
          now.getTime() - 1000,
          "usr_staff_01",
        );

      const repo = createStaffInvitationRepository(db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);

      // user.is_staff が 1 になっている
      const userRow = sqlite
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .get("usr_invitee") as { is_staff: number };
      expect(userRow.is_staff).toBe(1);

      // staff_invitation.status が accepted になっている
      const invRow = sqlite
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .get("inv_valid") as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Accepted);
    });

    it("期限切れの招待は false を返し、is_staff は変わらない", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_invitee", "招待された人", targetEmail, 1, 0, 0, 0);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_expired", targetEmail, "pending", expiredAt.getTime(), 0, "usr_staff_01");

      const repo = createStaffInvitationRepository(db);
      const result = await repo.accept({
        invitationId: "inv_expired",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);

      const userRow = sqlite
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .get("usr_invitee") as { is_staff: number };
      expect(userRow.is_staff).toBe(0);

      const invRow = sqlite
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .get("inv_expired") as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Pending);
    });

    it("取り消し済み・承諾済みの招待は false を返し、is_staff は変わらない", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_invitee", "招待された人", targetEmail, 1, 0, 0, 0);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_canceled", targetEmail, "canceled", validExpiresAt.getTime(), 0, "usr_staff_01");
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_accepted", targetEmail, "accepted", validExpiresAt.getTime(), 0, "usr_staff_01");

      const repo = createStaffInvitationRepository(db);

      const resCanceled = await repo.accept({
        invitationId: "inv_canceled",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });
      expect(resCanceled._unsafeUnwrap()).toBe(false);

      const resAccepted = await repo.accept({
        invitationId: "inv_accepted",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });
      expect(resAccepted._unsafeUnwrap()).toBe(false);

      const userRow = sqlite
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .get("usr_invitee") as { is_staff: number };
      expect(userRow.is_staff).toBe(0);
    });

    it("宛先違いの招待は false を返し、is_staff は変わらない", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_invitee", "招待された人", "other@osaka-u.ac.jp", 1, 0, 0, 0);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_valid", targetEmail, "pending", validExpiresAt.getTime(), 0, "usr_staff_01");

      const repo = createStaffInvitationRepository(db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: "other@osaka-u.ac.jp",
        userId: "usr_invitee",
        now,
      });

      expect(result._unsafeUnwrap()).toBe(false);
      const userRow = sqlite
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .get("usr_invitee") as { is_staff: number };
      expect(userRow.is_staff).toBe(0);
    });

    it("すでに事務局の人が承諾しても true になり、招待は accepted になる", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_already_staff", "すでにスタッフ", targetEmail, 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_valid", targetEmail, "pending", validExpiresAt.getTime(), 0, "usr_already_staff");

      const repo = createStaffInvitationRepository(db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: targetEmail,
        userId: "usr_already_staff",
        now,
      });

      expect(result._unsafeUnwrap()).toBe(true);
      const userRow = sqlite
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .get("usr_already_staff") as { is_staff: number };
      expect(userRow.is_staff).toBe(1);

      const invRow = sqlite
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .get("inv_valid") as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Accepted);
    });
  });

  describe("reject (辞退)", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const validExpiresAt = new Date("2026-04-03T12:00:00.000Z");
    const targetEmail = "invitee@osaka-u.ac.jp";

    it("辞退で status が rejected になり、件数 1 が返る", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_reject", targetEmail, "pending", validExpiresAt.getTime(), 0, "usr_staff_01");

      const repo = createStaffInvitationRepository(db);
      const result = await repo.reject({
        invitationId: "inv_reject",
        email: targetEmail,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);

      const invRow = sqlite
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .get("inv_reject") as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Rejected);
    });

    it("宛先違い・期限切れ・存在しない招待の辞退は件数 0 が返る", async () => {
      const { sqlite, db } = createTestDb();
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        )
        .run("usr_staff_01", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1);
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        .run("inv_other", targetEmail, "pending", validExpiresAt.getTime(), 0, "usr_staff_01");
      sqlite
        .prepare(
          `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        )
        // 期限ちょうどは切れている扱い
        .run("inv_expired", targetEmail, "pending", now.getTime(), 0, "usr_staff_01");

      const repo = createStaffInvitationRepository(db);
      const diffEmail = await repo.reject({
        invitationId: "inv_other",
        email: "wrong@osaka-u.ac.jp",
        now,
      });
      expect(diffEmail._unsafeUnwrap()).toBe(0);

      const expired = await repo.reject({
        invitationId: "inv_expired",
        email: targetEmail,
        now,
      });
      expect(expired._unsafeUnwrap()).toBe(0);

      // 0 件だった招待は、承諾待ちのまま残る
      const statuses = sqlite
        .prepare(`SELECT status FROM "staff_invitation" WHERE id IN (?, ?)`)
        .all("inv_other", "inv_expired") as { status: string }[];
      expect(statuses.map((row) => row.status)).toEqual([
        InvitationStatus.Pending,
        InvitationStatus.Pending,
      ]);

      const notFound = await repo.reject({
        invitationId: "inv_non_exist",
        email: targetEmail,
        now,
      });
      expect(notFound._unsafeUnwrap()).toBe(0);
    });
  });
});
