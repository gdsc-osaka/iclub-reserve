/**
 * 招待の送信・取り消し・辞退（UC-011 / UC-022）で、操作履歴（COND-013）が業務データと同じ batch で
 * 書かれることを、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 承諾は `invitation-accept-d1.test.ts` で確かめている。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import { GroupErrorCode } from "~/domain/group";
import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "../d1-test-db";
import { createInvitationRepository } from "./invitation-repo";

const testDb = useD1TestDb();

const NOW = new Date("2026-04-01T10:00:00.000Z");
const NOT_EXPIRED = new Date("2026-04-03T10:00:00.000Z");
const INVITEE_EMAIL = "hanako@ecs.osaka-u.ac.jp";

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_admin",
      "団体の管理者",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_1",
      "テスト団体",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_other",
      "ほかの団体",
      "enabled",
      0,
      0,
    ],
  );
});

const insertPendingInvitation = async () => {
  await testDb.seed([
    `INSERT INTO "group_invitation" (id, group_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?,?,?)`,
    "inv_1",
    "grp_1",
    INVITEE_EMAIL,
    MembershipRole.Member,
    InvitationStatus.Pending,
    NOT_EXPIRED.getTime(),
    0,
    "usr_admin",
  ]);
};

const auditLogRows = async () =>
  (
    await testDb.d1
      .prepare(`SELECT action, target_type, target_id, group_id, changes FROM "audit_log"`)
      .all<{
        action: string;
        target_type: string;
        target_id: string;
        group_id: string | null;
        changes: string;
      }>()
  ).results;

const draftFor = (action: AuditLogAction): AuditLogDraft => ({
  occurredAt: NOW,
  actorId: "usr_admin",
  actedAsStaff: false,
  action,
  targetId: "inv_1",
  groupId: "grp_1",
  changes: { email: { before: INVITEE_EMAIL, after: INVITEE_EMAIL } },
});

describe("招待の送信（InvitationRepository.create）", () => {
  const mailDraft: MailDraft = {
    idempotencyKey: `invitation:created:inv_1:${INVITEE_EMAIL}`,
    to: { address: INVITEE_EMAIL },
    subject: "テスト招待",
    text: "招待本文",
  };

  const createInput = {
    id: "inv_1",
    groupId: "grp_1",
    email: INVITEE_EMAIL,
    role: MembershipRole.Member,
    inviterUserId: "usr_admin",
    expiresAt: NOT_EXPIRED,
    createdAt: NOW,
  };

  it("招待・メールと一緒に、操作履歴がちょうど 1 行入る", async () => {
    const result = await createInvitationRepository(testDb.db).create(
      createInput,
      [mailDraft],
      draftFor(AuditLogAction.InvitationSend),
    );

    expect(result._unsafeUnwrap().enqueuedMailIds).toHaveLength(1);

    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.InvitationSend,
      target_type: "invitation",
      target_id: "inv_1",
      group_id: "grp_1",
    });
  });

  it("招待を書けなかったとき（ID の重複）は、batch ごと巻き戻って操作履歴も残らない", async () => {
    await insertPendingInvitation();

    const result = await createInvitationRepository(testDb.db).create(
      createInput,
      [{ ...mailDraft, idempotencyKey: `${mailDraft.idempotencyKey}:again` }],
      draftFor(AuditLogAction.InvitationSend),
    );

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(await auditLogRows()).toEqual([]);
  });
});

describe("招待の取り消し（InvitationRepository.cancel）", () => {
  it("承諾待ちなら取り消し、操作履歴がちょうど 1 行入る", async () => {
    await insertPendingInvitation();

    const result = await createInvitationRepository(testDb.db).cancel(
      "grp_1",
      "inv_1",
      draftFor(AuditLogAction.InvitationCancel),
    );

    expect(result._unsafeUnwrap()).toBe(1);
    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.InvitationCancel,
      target_type: "invitation",
      target_id: "inv_1",
    });
  });

  it("別の団体の招待としては取り消せず、操作履歴も入らない", async () => {
    await insertPendingInvitation();

    const result = await createInvitationRepository(testDb.db).cancel(
      "grp_other",
      "inv_1",
      draftFor(AuditLogAction.InvitationCancel),
    );

    expect(result._unsafeUnwrap()).toBe(0);
    expect(await auditLogRows()).toEqual([]);
  });

  it("同じ招待を 2 度取り消しても、操作履歴は 1 行だけ", async () => {
    await insertPendingInvitation();
    const repository = createInvitationRepository(testDb.db);

    const draft = draftFor(AuditLogAction.InvitationCancel);
    expect((await repository.cancel("grp_1", "inv_1", draft))._unsafeUnwrap()).toBe(1);
    expect((await repository.cancel("grp_1", "inv_1", draft))._unsafeUnwrap()).toBe(0);
    expect(await auditLogRows()).toHaveLength(1);
  });
});

describe("招待の辞退（InvitationRepository.reject）", () => {
  it("宛先本人が期限内に辞退すれば、操作履歴がちょうど 1 行入る", async () => {
    await insertPendingInvitation();

    const result = await createInvitationRepository(testDb.db).reject(
      { invitationId: "inv_1", email: INVITEE_EMAIL, now: NOW },
      draftFor(AuditLogAction.InvitationDecline),
    );

    expect(result._unsafeUnwrap()).toBe(1);
    const rows = await auditLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditLogAction.InvitationDecline,
      target_type: "invitation",
      target_id: "inv_1",
    });
  });

  it("宛先が違う人は辞退できず、操作履歴も入らない", async () => {
    await insertPendingInvitation();

    const result = await createInvitationRepository(testDb.db).reject(
      { invitationId: "inv_1", email: "jiro@ecs.osaka-u.ac.jp", now: NOW },
      draftFor(AuditLogAction.InvitationDecline),
    );

    expect(result._unsafeUnwrap()).toBe(0);
    expect(await auditLogRows()).toEqual([]);
  });
});
