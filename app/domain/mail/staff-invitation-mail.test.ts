import { describe, expect, it } from "vitest";
import {
  createStaffInvitationMailDraft,
  type StaffInvitationMailArgs,
} from "./staff-invitation-mail";

describe("createStaffInvitationMailDraft", () => {
  const baseArgs: StaffInvitationMailArgs = {
    invitationId: "inv_staff_123",
    email: "staff-new@osaka-u.ac.jp",
    expiresAt: new Date("2026-10-07T12:00:00.000Z"),
    appBaseUrl: "https://example.com",
  };

  it("idempotencyKey が staff-invitation:created:<id>:<email> になる", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.idempotencyKey).toBe(
      "staff-invitation:created:inv_staff_123:staff-new@osaka-u.ac.jp",
    );
  });

  it("同じ引数なら idempotencyKey が常に同一（乱数や時刻が混ざっていない）", () => {
    const draft1 = createStaffInvitationMailDraft(baseArgs);
    const draft2 = createStaffInvitationMailDraft(baseArgs);
    expect(draft1.idempotencyKey).toBe(draft2.idempotencyKey);
  });

  it("件名が事務局への招待通知になっている", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.subject).toBe("【i-Club予約システム】事務局への招待が届いています");
  });

  it("本文に承諾リンク（<appBaseUrl>/staff-invitations/<id>）が入る", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.text).toContain("https://example.com/staff-invitations/inv_staff_123");
  });

  it("本文に全団体・全予約を操作できるようになる旨が入る", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.text).toContain(
      "事務局になると、所属に関わらず全団体・全予約を操作できるようになります。",
    );
  });

  it("本文にログインおよび破棄に関する注意事項が入る", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.text).toContain("この宛先のメールアドレスでログインして開く必要があります");
    expect(draft.text).toContain("心当たりが無い場合は、このメールを破棄してください");
  });

  it("宛先が引数のメールアドレスになる", () => {
    const draft = createStaffInvitationMailDraft(baseArgs);
    expect(draft.to).toEqual({ address: "staff-new@osaka-u.ac.jp" });
  });
});
