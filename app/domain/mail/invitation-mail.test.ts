import { describe, expect, it } from "vitest";
import { MembershipRole } from "~/domain/membership";
import { createInvitationMailDraft, type InvitationMailArgs } from "./invitation-mail";

describe("createInvitationMailDraft", () => {
  const baseArgs: InvitationMailArgs = {
    invitationId: "inv_12345",
    groupName: "ロボット工学研究会",
    email: "taro@osaka-u.ac.jp",
    role: MembershipRole.Member,
    expiresAt: new Date("2026-09-23T12:00:00.000Z"),
    appBaseUrl: "https://example.com",
  };

  it("idempotencyKey が invitation:created:<id>:<email> になる", () => {
    const draft = createInvitationMailDraft(baseArgs);
    expect(draft.idempotencyKey).toBe("invitation:created:inv_12345:taro@osaka-u.ac.jp");
  });

  it("同じ引数なら idempotencyKey が 2 回とも同じ（乱数や時刻が混ざっていないことの確認）", () => {
    const draft1 = createInvitationMailDraft(baseArgs);
    const draft2 = createInvitationMailDraft(baseArgs);
    expect(draft1.idempotencyKey).toBe(draft2.idempotencyKey);
  });

  it("件名に団体名が入る", () => {
    const draft = createInvitationMailDraft(baseArgs);
    expect(draft.subject).toBe(
      "【i-Club予約システム】「ロボット工学研究会」への招待が届いています",
    );
  });

  it("本文に承諾リンク（<appBaseUrl>/invitations/<id>）が入る", () => {
    const draft = createInvitationMailDraft(baseArgs);
    expect(draft.text).toContain("https://example.com/invitations/inv_12345");
  });

  it("本文の「役割」が membershipRoleLabel の文言になる（admin → 管理者、member → メンバー）", () => {
    const memberDraft = createInvitationMailDraft({
      ...baseArgs,
      role: MembershipRole.Member,
    });
    expect(memberDraft.text).toContain("役割: メンバー");

    const adminDraft = createInvitationMailDraft({
      ...baseArgs,
      role: MembershipRole.Admin,
    });
    expect(adminDraft.text).toContain("役割: 管理者");
  });

  it("宛先が引数のメールアドレスになる", () => {
    const draft = createInvitationMailDraft(baseArgs);
    expect(draft.to).toEqual({ address: "taro@osaka-u.ac.jp" });
  });
});
