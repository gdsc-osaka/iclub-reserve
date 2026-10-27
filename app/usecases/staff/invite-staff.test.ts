import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";
import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  type CreateStaffInvitationOutcome,
  StaffErrorCode,
  StaffField,
  type StaffInvitation,
} from "~/domain/staff";
import { fakeMailOutboxNotifier } from "~/testing/fakes/mail";
import { fakeStaffInvitationRepository, fakeStaffMemberRepository } from "~/testing/fakes/staff";
import { inviteStaffUseCase, type InviteStaffArgs } from "./invite-staff";

describe("inviteStaffUseCase", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const baseArgs: InviteStaffArgs = {
    actorUserId: "usr_staff_actor",
    isStaff: true,
    email: "new-staff@osaka-u.ac.jp",
    now,
    appBaseUrl: "https://example.com",
  };

  const setupDeps = (
    options: {
      staffByEmail?: { id: string } | null;
      pendingInvitation?: StaffInvitation | null;
    } = {},
  ) => {
    const create = vi.fn((_input: unknown, _mails: readonly MailDraft[], _auditLog: unknown) =>
      okAsync<CreateStaffInvitationOutcome>({
        enqueuedMailIds: ["mail_created_1"],
      }),
    );
    const notifyEnqueued = vi.fn((_ids: readonly string[]) => okAsync(null));

    const staffMemberRepository = fakeStaffMemberRepository({
      findStaffByEmail: (_normalizedEmail) => {
        if (options.staffByEmail !== undefined) {
          return okAsync(options.staffByEmail);
        }
        return okAsync(null);
      },
    });

    const staffInvitationRepository = fakeStaffInvitationRepository({
      findPendingByEmail: () => okAsync(options.pendingInvitation ?? null),
      create,
    });

    const mailOutboxNotifier = fakeMailOutboxNotifier({
      notifyEnqueued,
    });

    return {
      deps: { staffMemberRepository, staffInvitationRepository, mailOutboxNotifier },
      create,
      notifyEnqueued,
    };
  };

  it("事務局でない人は拒否される", async () => {
    const { deps } = setupDeps();
    const result = await inviteStaffUseCase(deps, { ...baseArgs, isStaff: false });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.Forbidden);
    }
  });

  it("メールアドレスが不正な場合は InvalidInput を返す", async () => {
    const { deps } = setupDeps();
    const result = await inviteStaffUseCase(deps, { ...baseArgs, email: "invalid-email" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
      expect(result.error.field).toBe(StaffField.Email);
    }
  });

  it("宛先がすでに事務局の場合は InvalidInput を返す（大文字混じりでも検出）", async () => {
    const { deps } = setupDeps({ staffByEmail: { id: "usr_existing_staff" } });
    const result = await inviteStaffUseCase(deps, {
      ...baseArgs,
      email: "Existing-Staff@Osaka-U.ac.jp",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
      expect(result.error.field).toBe(StaffField.Email);
      expect(result.error.userMessage).toBe("このメールアドレスの方は、すでに事務局です。");
      // ADR-004: message にメールアドレスが含まれていないこと
      expect(result.error.message).not.toContain("Existing-Staff");
    }
  });

  it("承諾待ちで期限内の招待がある場合は InvalidInput で拒否される", async () => {
    const futureExpiresAt = new Date(now.getTime() + 10 * 3600 * 1000);
    const pendingInvitation: StaffInvitation = {
      id: "inv_existing_pending",
      email: baseArgs.email,
      status: InvitationStatus.Pending,
      expiresAt: futureExpiresAt,
      inviterId: "usr_prev_staff",
      createdAt: new Date(now.getTime() - 1000),
    };

    const { deps } = setupDeps({ pendingInvitation });
    const result = await inviteStaffUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
      expect(result.error.field).toBe(StaffField.Email);
      expect(result.error.userMessage).toContain("すでに招待を送っています");
    }
  });

  it("承諾待ちでも期限切れの招待であれば送り直せる", async () => {
    const expiredAt = new Date(now.getTime() - 1000); // 期限切れ
    const pendingInvitation: StaffInvitation = {
      id: "inv_expired",
      email: baseArgs.email,
      status: InvitationStatus.Pending,
      expiresAt: expiredAt,
      inviterId: "usr_prev_staff",
      createdAt: new Date(now.getTime() - 50 * 3600 * 1000),
    };

    const { deps, create, notifyEnqueued } = setupDeps({
      pendingInvitation,
    });
    const result = await inviteStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const [callInput, callMails] = create.mock.calls[0]!;
    expect(callInput).not.toBeNull();
    expect(callMails).toHaveLength(1);
    expect(notifyEnqueued).toHaveBeenCalledWith(["mail_created_1"]);
  });

  it("正常に招待が作成され、メール下書き登録と即時配送依頼が行われる", async () => {
    const { deps, create, notifyEnqueued } = setupDeps();
    const result = await inviteStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.invitationId).toBeDefined();
    }
    expect(create).toHaveBeenCalledTimes(1);
    const [input, mails, auditLog] = create.mock.calls[0] as [
      { email: string; inviterId: string },
      readonly MailDraft[],
      unknown,
    ];
    expect(input.email).toBe(baseArgs.email);
    expect(input.inviterId).toBe(baseArgs.actorUserId);

    expect(mails).toHaveLength(1);
    expect(mails[0].to.address).toBe(baseArgs.email);

    expect(notifyEnqueued).toHaveBeenCalledWith(["mail_created_1"]);

    expect(auditLog).toMatchObject({
      action: "staff_role.invite",
      actorId: baseArgs.actorUserId,
      actedAsStaff: true,
      targetId: expect.any(String),
      groupId: null,
      changes: {
        email: { before: null, after: baseArgs.email },
      },
    });
  });
});
