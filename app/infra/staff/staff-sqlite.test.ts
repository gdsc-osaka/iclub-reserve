import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
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

  const batch = (queries: readonly PromiseLike<unknown>[]) => {
    return Promise.all(queries);
  };
  const db = Object.assign(drizzle(sqlite, { schema }), { batch }) as unknown as Database;

  return { sqlite, db };
};

describe("Staff Repositories & Query (SQLite)", () => {
  it("招待と outbox が同じ batch で入る", async () => {
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
});
