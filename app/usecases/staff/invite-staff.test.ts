import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { InvitationStatus } from "~/domain/invitation";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import {
  type CreateStaffInvitationInput,
  type CreateStaffInvitationOutcome,
  StaffErrorCode,
  StaffField,
  type StaffInvitation,
  type StaffInvitationRepository,
  type StaffMemberRepository,
} from "~/domain/staff";
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
    let createdInput: CreateStaffInvitationInput | null = null;
    let createdMails: readonly MailDraft[] = [];
    const requestedMailIds: string[] = [];

    const staffMemberRepository: StaffMemberRepository = {
      findStaffByEmail: (_normalizedEmail) => {
        if (options.staffByEmail !== undefined) {
          return okAsync(options.staffByEmail);
        }
        return okAsync(null);
      },
      findStaffById: () => okAsync(null),
      countStaff: () => okAsync(2),
      revoke: () => okAsync(1),
    };

    const staffInvitationRepository: StaffInvitationRepository = {
      findPendingByEmail: () => okAsync(options.pendingInvitation ?? null),
      create: (input, mails) => {
        createdInput = input;
        createdMails = mails;
        return okAsync<CreateStaffInvitationOutcome>({
          enqueuedMailIds: ["mail_created_1"],
        });
      },
      cancel: () => okAsync(1),
      findById: () => okAsync(null),
      accept: () => okAsync(false),
      reject: () => okAsync(0),
    };

    const mailOutboxNotifier: MailOutboxNotifier = {
      notifyEnqueued: (ids) => {
        requestedMailIds.push(...ids);
        return okAsync(null);
      },
    };

    return {
      deps: { staffMemberRepository, staffInvitationRepository, mailOutboxNotifier },
      getCreatedInput: () => createdInput,
      getCreatedMails: () => createdMails,
      getRequestedMailIds: () => requestedMailIds,
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

    const { deps, getCreatedInput, getCreatedMails, getRequestedMailIds } = setupDeps({
      pendingInvitation,
    });
    const result = await inviteStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    expect(getCreatedInput()).not.toBeNull();
    expect(getCreatedMails()).toHaveLength(1);
    expect(getRequestedMailIds()).toEqual(["mail_created_1"]);
  });

  it("正常に招待が作成され、メール下書き登録と即時配送依頼が行われる", async () => {
    const { deps, getCreatedInput, getCreatedMails, getRequestedMailIds } = setupDeps();
    const result = await inviteStaffUseCase(deps, baseArgs);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.invitationId).toBeDefined();
    }
    const input = getCreatedInput();
    expect(input?.email).toBe(baseArgs.email);
    expect(input?.inviterId).toBe(baseArgs.actorUserId);

    const mails = getCreatedMails();
    expect(mails).toHaveLength(1);
    expect(mails[0].to.address).toBe(baseArgs.email);

    expect(getRequestedMailIds()).toEqual(["mail_created_1"]);
  });
});
