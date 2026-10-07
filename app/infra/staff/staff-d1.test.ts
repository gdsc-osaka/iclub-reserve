import { describe, expect, it } from "vitest";
import { useD1TestDb } from "../d1-test-db";

import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { createStaffInvitationRepository } from "./staff-invitation-repo";
import { createStaffManagementQuery } from "./staff-management-query";
import { createStaffMemberRepository } from "./staff-member-repo";

/*
 * 招待と通知メールの outbox、承諾のユーザーと招待は、それぞれ同じ `db.batch()` で書く（ADR-002）。
 * ここでは本物の D1 の batch を通るので、どちらかが失敗すれば両方とも巻き戻る、という本番と同じ振る舞いの上で確かめている。
 */
const testDb = useD1TestDb();

describe("Staff Repositories & Query (D1)", () => {
  it("招待の行と outbox のメールが入り、enqueuedMailIds が返る", async () => {
    // 招待者を登録
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff_01",
      "スタッフ1",
      "staff1@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ]);

    const repo = createStaffInvitationRepository(testDb.db);

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

    const invitationRow = (await testDb.d1
      .prepare(`SELECT * FROM "staff_invitation" WHERE id = ?`)
      .bind("inv_1")
      .first()) as { id: string; email: string; status: string } | undefined;
    expect(invitationRow).toBeDefined();
    expect(invitationRow?.email).toBe("new@osaka-u.ac.jp");
    expect(invitationRow?.status).toBe("pending");

    const outboxRow = (await testDb.d1
      .prepare(`SELECT * FROM "mail_outbox" WHERE idempotency_key = ?`)
      .bind(mailDraft.idempotencyKey)
      .first()) as { id: string; to_address: string } | undefined;
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.to_address).toBe("new@osaka-u.ac.jp");
  });

  it("cancel は pending にしか効かない", async () => {
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff_01",
      "スタッフ1",
      "staff1@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ]);

    await testDb.seed([
      `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      "inv_pending",
      "p@osaka-u.ac.jp",
      "pending",
      999999999,
      0,
      "usr_staff_01",
    ]);

    await testDb.seed([
      `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      "inv_canceled",
      "c@osaka-u.ac.jp",
      "canceled",
      999999999,
      0,
      "usr_staff_01",
    ]);

    const repo = createStaffInvitationRepository(testDb.db);

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
    const insertUser = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
    await testDb.seed([insertUser, "usr_staff_1", "スタッフ1", "staff1@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_staff_2", "スタッフ2", "staff2@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_normal", "一般", "normal@osaka-u.ac.jp", 1, 0, 0, 0]);

    const repo = createStaffMemberRepository(testDb.db);

    // 事務局が 2 人のとき、片方を剥奪すると 1 件
    const now = new Date("2026-10-05T12:00:00Z");
    const revoke1 = await repo.revoke("usr_staff_1", now);
    expect(revoke1.isOk()).toBe(true);
    if (revoke1.isOk()) {
      expect(revoke1.value).toBe(1);
    }

    // 剥奪されたことを確認
    const row1 = (await testDb.d1
      .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
      .bind("usr_staff_1")
      .first()) as {
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
    const row2 = (await testDb.d1
      .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
      .bind("usr_staff_2")
      .first()) as {
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
    const insertUser = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
    await testDb.seed([
      insertUser,
      "usr_staff_1",
      "スタッフ1",
      "Staff.One@Osaka-U.ac.jp",
      1,
      0,
      0,
      1,
    ]);
    await testDb.seed([insertUser, "usr_staff_2", "スタッフ2", "staff2@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_normal", "一般", "normal@osaka-u.ac.jp", 1, 0, 0, 0]);

    const repo = createStaffMemberRepository(testDb.db);

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
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff_01",
      "スタッフ1",
      "staff1@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ]);

    const insertInv = `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`;
    await testDb.seed([
      insertInv,
      "inv_old",
      "target@osaka-u.ac.jp",
      "pending",
      1000,
      0,
      "usr_staff_01",
    ]);
    await testDb.seed([
      insertInv,
      "inv_new",
      "target@osaka-u.ac.jp",
      "pending",
      2000,
      0,
      "usr_staff_01",
    ]);
    // 取り消し済みは期限が遅くても対象外
    await testDb.seed([
      insertInv,
      "inv_canceled",
      "target@osaka-u.ac.jp",
      "canceled",
      3000,
      0,
      "usr_staff_01",
    ]);
    await testDb.seed([
      insertInv,
      "inv_only_canceled",
      "gone@osaka-u.ac.jp",
      "canceled",
      3000,
      0,
      "usr_staff_01",
    ]);

    const repo = createStaffInvitationRepository(testDb.db);

    // 期限（1000 / 2000 ミリ秒）はとうに過ぎているが、判定はユースケースに任せるので返す
    const found = (await repo.findPendingByEmail("target@osaka-u.ac.jp"))._unsafeUnwrap();
    expect(found?.id).toBe("inv_new");
    expect(found?.expiresAt.getTime()).toBe(2000);

    expect((await repo.findPendingByEmail("gone@osaka-u.ac.jp"))._unsafeUnwrap()).toBeNull();
  });

  it("読み取りモデルの並び順と pending の絞り込み", async () => {
    const insertUser = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
    // 氏名の昇順、同名は id の昇順
    await testDb.seed([insertUser, "usr_b", "B 事務局", "b@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_a2", "A 事務局", "a2@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_a1", "A 事務局", "a1@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_normal", "一般 太郎", "normal@osaka-u.ac.jp", 1, 0, 0, 0]); // 事務局でない

    const insertInv = `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`;
    // expires_at の昇順、同期限は id の昇順
    await testDb.seed([insertInv, "inv_2", "two@osaka-u.ac.jp", "pending", 2000, 0, "usr_a1"]);
    await testDb.seed([insertInv, "inv_1b", "one_b@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1"]);
    await testDb.seed([insertInv, "inv_1a", "one_a@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1"]);
    await testDb.seed([
      insertInv,
      "inv_canceled",
      "canceled@osaka-u.ac.jp",
      "canceled",
      500,
      0,
      "usr_a1",
    ]); // pending でない

    const query = createStaffManagementQuery(testDb.db);
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
    await testDb.seed([
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_staff_01",
      "スタッフ1",
      "staff1@osaka-u.ac.jp",
      1,
      0,
      0,
      1,
    ]);

    await testDb.seed([
      `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
      "inv_exists",
      "target@osaka-u.ac.jp",
      "pending",
      5000,
      1000,
      "usr_staff_01",
    ]);

    const repo = createStaffInvitationRepository(testDb.db);

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
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_invitee",
        "招待された人",
        targetEmail,
        1,
        0,
        0,
        0,
      ]);

      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_valid",
        targetEmail,
        "pending",
        validExpiresAt.getTime(),
        now.getTime() - 1000,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);

      // user.is_staff が 1 になっている
      const userRow = (await testDb.d1
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .bind("usr_invitee")
        .first()) as { is_staff: number };
      expect(userRow.is_staff).toBe(1);

      // staff_invitation.status が accepted になっている
      const invRow = (await testDb.d1
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .bind("inv_valid")
        .first()) as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Accepted);
    });

    it("期限切れの招待は false を返し、is_staff は変わらない", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_invitee",
        "招待された人",
        targetEmail,
        1,
        0,
        0,
        0,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_expired",
        targetEmail,
        "pending",
        expiredAt.getTime(),
        0,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
      const result = await repo.accept({
        invitationId: "inv_expired",
        email: targetEmail,
        userId: "usr_invitee",
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);

      const userRow = (await testDb.d1
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .bind("usr_invitee")
        .first()) as { is_staff: number };
      expect(userRow.is_staff).toBe(0);

      const invRow = (await testDb.d1
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .bind("inv_expired")
        .first()) as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Pending);
    });

    it("取り消し済み・承諾済みの招待は false を返し、is_staff は変わらない", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_invitee",
        "招待された人",
        targetEmail,
        1,
        0,
        0,
        0,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_canceled",
        targetEmail,
        "canceled",
        validExpiresAt.getTime(),
        0,
        "usr_staff_01",
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_accepted",
        targetEmail,
        "accepted",
        validExpiresAt.getTime(),
        0,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);

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

      const userRow = (await testDb.d1
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .bind("usr_invitee")
        .first()) as { is_staff: number };
      expect(userRow.is_staff).toBe(0);
    });

    it("宛先違いの招待は false を返し、is_staff は変わらない", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_invitee",
        "招待された人",
        "other@osaka-u.ac.jp",
        1,
        0,
        0,
        0,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_valid",
        targetEmail,
        "pending",
        validExpiresAt.getTime(),
        0,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: "other@osaka-u.ac.jp",
        userId: "usr_invitee",
        now,
      });

      expect(result._unsafeUnwrap()).toBe(false);
      const userRow = (await testDb.d1
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .bind("usr_invitee")
        .first()) as { is_staff: number };
      expect(userRow.is_staff).toBe(0);
    });

    it("すでに事務局の人が承諾しても true になり、招待は accepted になる", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_already_staff",
        "すでにスタッフ",
        targetEmail,
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_valid",
        targetEmail,
        "pending",
        validExpiresAt.getTime(),
        0,
        "usr_already_staff",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
      const result = await repo.accept({
        invitationId: "inv_valid",
        email: targetEmail,
        userId: "usr_already_staff",
        now,
      });

      expect(result._unsafeUnwrap()).toBe(true);
      const userRow = (await testDb.d1
        .prepare(`SELECT is_staff FROM "user" WHERE id = ?`)
        .bind("usr_already_staff")
        .first()) as { is_staff: number };
      expect(userRow.is_staff).toBe(1);

      const invRow = (await testDb.d1
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .bind("inv_valid")
        .first()) as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Accepted);
    });
  });

  describe("reject (辞退)", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const validExpiresAt = new Date("2026-04-03T12:00:00.000Z");
    const targetEmail = "invitee@osaka-u.ac.jp";

    it("辞退で status が rejected になり、件数 1 が返る", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_reject",
        targetEmail,
        "pending",
        validExpiresAt.getTime(),
        0,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
      const result = await repo.reject({
        invitationId: "inv_reject",
        email: targetEmail,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);

      const invRow = (await testDb.d1
        .prepare(`SELECT status FROM "staff_invitation" WHERE id = ?`)
        .bind("inv_reject")
        .first()) as { status: string };
      expect(invRow.status).toBe(InvitationStatus.Rejected);
    });

    it("宛先違い・期限切れ・存在しない招待の辞退は件数 0 が返る", async () => {
      await testDb.seed([
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
        "usr_staff_01",
        "スタッフ1",
        "staff1@osaka-u.ac.jp",
        1,
        0,
        0,
        1,
      ]);
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_other",
        targetEmail,
        "pending",
        validExpiresAt.getTime(),
        0,
        "usr_staff_01",
      ]);
      // 期限ちょうどは切れている扱い
      await testDb.seed([
        `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`,
        "inv_expired",
        targetEmail,
        "pending",
        now.getTime(),
        0,
        "usr_staff_01",
      ]);

      const repo = createStaffInvitationRepository(testDb.db);
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
      const statuses = (
        await testDb.d1
          .prepare(`SELECT status FROM "staff_invitation" WHERE id IN (?, ?)`)
          .bind("inv_other", "inv_expired")
          .all()
      ).results as { status: string }[];
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
